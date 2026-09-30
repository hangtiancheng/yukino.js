import { Value } from "./store.js";

export class ByteView implements Value {
  private b: Buffer;

  constructor(b: Buffer) {
    this.b = b;
  }

  len(): number {
    return this.b.length;
  }

  byteSlice(): Buffer {
    return Buffer.from(this.b);
  }

  toString(): string {
    return this.b.toString();
  }
}

export function cloneBytes(b: Buffer): Buffer {
  const c = Buffer.alloc(b.length);
  b.copy(c);
  return c;
}
