# @yukino.js/skiplist

A generic ordered map backed by a skip list, aligned with
`yukino.go/libs/yukino_skiplist`. Requires Node.js 22+.
This replaces the previous score/member sorted set API.

```ts
import {
  SkipList,
  dump,
  load,
  intCodec,
  stringCodec,
} from "@yukino.js/skiplist";

const list = new SkipList<number, string>();
list.insert(2, "two"); // true; never overwrites
list.insert(2, "ignored"); // false
const [previous, existed] = list.set(2, "II");
list.get(2); // "II"
list.floor(3); // { key: 2, value: "II" }
for (const { key, value } of list.range(0, 10)) {
  list.delete(key); // iteration uses a detached snapshot
}

const format = { key: intCodec, value: stringCodec };
const restored = load(dump(list, format), format);
```

`new SkipList<K, V>({ compare, maxLevel, probability, random })` accepts an
optional comparator. Without one, keys must consistently be numbers, strings,
or bigints. Numbers follow Go `cmp.Compare`: NaN equals NaN and sorts before
other numbers; -0 equals +0. Valid Unicode strings sort in UTF-8 order,
including supplementary characters. For objects, supply a comparator:

```ts
const list = new SkipList<{ id: number }, string>({
  compare: (a, b) => a.id - b.id,
});
```

Comparator equality defines identity. Updating a value retains the original
key. Keys must keep their ordering while stored. Comparators and random sources
must not reenter the list. Comparators must define a total order and return a
negative number, zero, or a positive number; NaN results are rejected.

Defaults match Go: `maxLevel = 16`, `probability = 0.5`. Heights count lanes,
including the bottom lane. `maxLevel` accepts integers from 1 to 4096;
probability must be in (0, 1), and random draws in [0, 1).

| TypeScript                                     | Go                                        | Result                                 |
| ---------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| `length`, `level`, `maxLevel`, `probability`   | `Len`, `Level`, `MaxLevel`, `Probability` | diagnostics; empty level is 0          |
| `insert(key, value)`                           | `Insert`                                  | whether inserted                       |
| `set(key, value)`                              | `Set`                                     | `[previous, existed]`                  |
| `get(key)`, `has(key)`                         | `Get`, `Has`                              | value or undefined; presence check     |
| `delete(key)`                                  | `Delete`                                  | `[value, deleted]`                     |
| `clear()`                                      | `Clear`                                   | remove all entries                     |
| `min()`, `max()`, `floor(key)`, `ceiling(key)` | corresponding methods                     | `{key, value}` or undefined            |
| `all()`, `[Symbol.iterator]()`                 | `All`                                     | ordered entries                        |
| `range(from, to)`, `rangeFrom(from)`           | `Range`, `RangeFrom`                      | half-open [from, to), or [from, end)   |
| `keys()`, `values()`, `snapshot()`             | corresponding methods                     | ordered keys, values, detached entries |

Use `has` to distinguish a stored undefined from a missing key. Lookup and
mutation take expected O(log n) time; min and length are O(1). Iterators capture
a shallow snapshot when requested, so subsequent list mutations do not change
it. Full iteration costs O(n) memory; bounded ranges take O(log n + k) time and
O(k) memory. Keys and values are not deep-copied. Go captures its snapshot when
its sequence starts running. Clearing replaces the header in O(maxLevel) time.

## Persistence

`dump(list, format)` returns text; `load(text, format, options?)` creates a new
list. `dumpFile(list, path, format)` and `loadFile(path, format, options?)` are
async. Files use the same escaped UTF-8 format as Go: `key:value\n`. Backslashes,
separators, CR and LF in fields are escaped. Empty fields, CRLF input, blank
padding lines, and a final record without LF are supported.

`Format<K, V>` supplies `key` and `value` codecs with `encode`/`decode` functions
and an optional single printable ASCII `separator` (default `:`; backslash,
`n`, and `r` are reserved). Exports include `stringCodec`, `boolCodec`,
`intCodec` (safe JS integers), `int64Codec`/`uint64Codec` (bigint),
`float64Codec`, and `bytesCodec` (unpadded standard base64). Custom codecs can
encode structured values. Text must be valid Unicode; binary belongs in a
bytes codec. Numeric codecs read the canonical decimal output of Go codecs.

Malformed escapes, codec failures, duplicate comparator-equal keys and records
larger than 16 MiB are rejected. `ParseError` includes the one-based `line`,
`record` and underlying `cause`; failed loads never expose partial lists.
File dumps encode a snapshot, write and sync a temporary file in the destination
directory, rename it over the target, then sync the directory. File I/O streams
records in bounded chunks instead of buffering the whole file. A directory-sync
error is reported after the rename has taken effect.

```sh
pnpm test
pnpm typecheck
pnpm build
```
