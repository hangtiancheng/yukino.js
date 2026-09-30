const crcTable: number[] = new Array(256);

(function initCrcTable() {
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    crcTable[i] = c >>> 0;
  }
})();

export function crc32(data: string | Buffer): number {
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  let crcValue = 0xffffffff;

  for (const byte of bytes) {
    crcValue = crcTable[(crcValue ^ byte) & 0xff] ^ (crcValue >>> 8);
  }

  return (crcValue ^ 0xffffffff) >>> 0;
}

export type HashFunc = (data: string | Buffer) => number;
