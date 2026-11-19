import { mkdir, open, rename, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { SkipList, type SkipListOptions, type Entry } from "./skiplist.js";

export const MAX_RECORD_SIZE = 16 << 20;
export interface TextCodec<T> {
  encode(value: T): string;
  decode(text: string): T;
}
export interface Format<K, V> {
  readonly key: TextCodec<K>;
  readonly value: TextCodec<V>;
  readonly separator?: string;
}
export class ParseError extends Error {
  constructor(
    readonly line: number,
    readonly record: string,
    cause: unknown,
  ) {
    super(
      `skiplist: line ${line} (${JSON.stringify(record.slice(0, 32))}): ${String(cause)}`,
      { cause },
    );
    this.name = "ParseError";
  }
}
function separatorOf<K, V>(format: Format<K, V>): string {
  if (
    typeof format.key?.encode !== "function" ||
    typeof format.key.decode !== "function" ||
    typeof format.value?.encode !== "function" ||
    typeof format.value.decode !== "function"
  )
    throw new TypeError("skiplist: format requires key and value codecs");
  const sep = format.separator ?? ":";
  if (!/^[\x21-\x7e]$/.test(sep) || ["\\", "n", "r"].includes(sep))
    throw new TypeError(
      "skiplist: separator must be printable ASCII other than backslash, n or r",
    );
  return sep;
}
function escape(text: string, separator: string): string {
  if (typeof text !== "string" || !text.isWellFormed())
    throw new TypeError("skiplist: codec must encode valid Unicode text");
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(separator, "\\" + separator)
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}
function unescape(text: string, separator: string): string {
  return text.replace(/\\([\s\S])|\\$/g, (_match, char: string | undefined) => {
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    if (char === "\\" || char === separator) return char;
    throw new Error("invalid escape sequence");
  });
}
function encodeRecord<K, V>(
  { key, value }: Entry<K, V>,
  format: Format<K, V>,
  sep: string,
): string {
  const record = `${escape(format.key.encode(key), sep)}${sep}${escape(format.value.encode(value), sep)}`;
  if (Buffer.byteLength(record) > MAX_RECORD_SIZE)
    throw new RangeError("record too large");
  return record + "\n";
}
function appendRecord<K, V>(
  list: SkipList<K, V>,
  record: string,
  format: Format<K, V>,
  sep: string,
  line: number,
): void {
  if (record.endsWith("\r")) record = record.slice(0, -1);
  if (!record) return;
  try {
    if (Buffer.byteLength(record) > MAX_RECORD_SIZE)
      throw new RangeError("record too large");
    let split = -1;
    for (let i = 0; i < record.length; i++) {
      if (record[i] === "\\") i++;
      else if (record[i] === sep) {
        split = i;
        break;
      }
    }
    if (split < 0) throw new Error("malformed record: missing separator");
    const key = format.key.decode(unescape(record.slice(0, split), sep));
    const value = format.value.decode(unescape(record.slice(split + 1), sep));
    if (!list.insert(key, value)) throw new Error("duplicate key");
  } catch (cause) {
    throw new ParseError(line, record, cause);
  }
}
/** Same escaped UTF-8 records as Go Dump. Encoding uses a detached snapshot. */
export function dump<K, V>(list: SkipList<K, V>, format: Format<K, V>): string {
  const sep = separatorOf(format);
  return list
    .snapshot()
    .map((entry) => encodeRecord(entry, format, sep))
    .join("");
}
/** A failed load never publishes a partially loaded list. Comparator-equal
 * duplicates are rejected, blank lines and CRLF are accepted. */
export function load<K, V>(
  text: string,
  format: Format<K, V>,
  options: SkipListOptions<K> = {},
): SkipList<K, V> {
  const sep = separatorOf(format),
    list = new SkipList<K, V>(options);
  if (!text.isWellFormed())
    throw new TypeError("skiplist: input must be valid Unicode");
  // Scan by offset to avoid allocating an array containing every input line.
  let offset = 0,
    line = 0;
  while (offset < text.length) {
    line++;
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const record = text.slice(offset, end);
    offset = newline < 0 ? text.length : end + 1;
    appendRecord(list, record, format, sep, line);
  }
  return list;
}
export async function dumpFile<K, V>(
  list: SkipList<K, V>,
  path: string,
  format: Format<K, V>,
): Promise<void> {
  const sep = separatorOf(format),
    entries = list.snapshot(),
    dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const temp = join(
    dir,
    `.${basename(path)}.tmp-${randomBytes(12).toString("hex")}`,
  );
  const file = await open(temp, "wx", 0o644);
  try {
    let buffered = "",
      bytes = 0;
    for (const entry of entries) {
      const record = encodeRecord(entry, format, sep);
      buffered += record;
      bytes += Buffer.byteLength(record);
      if (bytes >= 65536) {
        await file.writeFile(buffered, "utf8");
        buffered = "";
        bytes = 0;
      }
    }
    if (buffered) await file.writeFile(buffered, "utf8");
    await file.sync();
    await file.close();
    await rename(temp, path);
    const directory = await open(dir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await file.close();
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export async function loadFile<K, V>(
  path: string,
  format: Format<K, V>,
  options: SkipListOptions<K> = {},
): Promise<SkipList<K, V>> {
  const sep = separatorOf(format),
    list = new SkipList<K, V>(options);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let parts: Buffer[] = [],
    size = 0,
    line = 1;
  const append = (bytes: Buffer): void => {
    size += bytes.length;
    if (
      size > MAX_RECORD_SIZE + 1 ||
      (size > MAX_RECORD_SIZE &&
        (bytes.length ? bytes.at(-1) : parts.at(-1)?.at(-1)) !== 13)
    ) {
      throw new ParseError(line, "", new RangeError("record too large"));
    }
    if (bytes.length) parts.push(bytes);
  };
  const finish = (): void => {
    const bytes = Buffer.concat(parts, size);
    let record: string;
    try {
      record = decoder.decode(bytes);
    } catch (cause) {
      throw new ParseError(line, "", cause);
    }
    appendRecord(list, record, format, sep, line);
    parts = [];
    size = 0;
    line++;
  };
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    let offset = 0;
    for (;;) {
      const newline = bytes.indexOf(10, offset);
      if (newline < 0) {
        append(bytes.subarray(offset));
        break;
      }
      append(bytes.subarray(offset, newline));
      finish();
      offset = newline + 1;
    }
  }
  if (size) finish();
  return list;
}

export const stringCodec: TextCodec<string> = {
  encode: (value) => value,
  decode: (text) => text,
};
export const boolCodec: TextCodec<boolean> = {
  encode: (value) => String(value),
  decode: (text) => {
    if (["1", "t", "T", "true", "TRUE", "True"].includes(text)) return true;
    if (["0", "f", "F", "false", "FALSE", "False"].includes(text)) return false;
    throw new TypeError("invalid boolean");
  },
};
export const intCodec: TextCodec<number> = {
  encode: (value) => {
    if (!Number.isSafeInteger(value))
      throw new RangeError("integer exceeds safe range");
    return String(value);
  },
  decode: (text) => {
    if (!/^[+-]?\d+$/.test(text)) throw new TypeError("invalid integer");
    const value = Number(text);
    if (!Number.isSafeInteger(value))
      throw new RangeError("integer exceeds safe range");
    return value;
  },
};
function bigintCodec(min: bigint, max: bigint): TextCodec<bigint> {
  const check = (value: bigint): bigint => {
    if (value < min || value > max)
      throw new RangeError("integer out of range");
    return value;
  };
  return {
    encode: (value) => String(check(value)),
    decode: (text) => {
      if (!(min === 0n ? /^\d+$/ : /^[+-]?\d+$/).test(text))
        throw new TypeError("invalid integer");
      return check(BigInt(text));
    },
  };
}
export const int64Codec = bigintCodec(-(1n << 63n), (1n << 63n) - 1n);
export const uint64Codec = bigintCodec(0n, (1n << 64n) - 1n);
export const float64Codec: TextCodec<number> = {
  encode: (value) =>
    Number.isNaN(value)
      ? "NaN"
      : value === Infinity
        ? "+Inf"
        : value === -Infinity
          ? "-Inf"
          : Object.is(value, -0)
            ? "-0"
            : String(value),
  decode: (text) => {
    if (/^[+]?inf(?:inity)?$/i.test(text)) return Infinity;
    if (/^-inf(?:inity)?$/i.test(text)) return -Infinity;
    if (/^nan$/i.test(text)) return NaN;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
      throw new TypeError("invalid float");
    const value = Number(text);
    if (!Number.isFinite(value)) throw new RangeError("float out of range");
    return value;
  },
};
export const bytesCodec: TextCodec<Uint8Array> = {
  encode: (value) => Buffer.from(value).toString("base64").replace(/=+$/, ""),
  decode: (text) => {
    const clean = text.replace(/[\r\n]/g, "");
    if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1)
      throw new TypeError("invalid unpadded base64");
    return Buffer.from(clean, "base64");
  },
};
