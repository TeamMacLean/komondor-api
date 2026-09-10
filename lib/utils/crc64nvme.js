const POLYNOMIAL = 0x9a6c9329ac4bc9b5n;
const MASK_64 = 0xffffffffffffffffn;

const TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = BigInt(index);
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1n) === 1n ? (value >> 1n) ^ POLYNOMIAL : value >> 1n;
  }
  return {
    high: Number((value >> 32n) & 0xffffffffn) >>> 0,
    low: Number(value & 0xffffffffn) >>> 0,
  };
});

/**
 * Streaming CRC-64/NVME. The lookup table is generated once with BigInt, while
 * the hot update loop uses two unsigned 32-bit halves.
 */
class Crc64Nvme {
  constructor() {
    this.high = 0xffffffff;
    this.low = 0xffffffff;
  }

  /**
   * @param {Buffer|Uint8Array|string} chunk bytes to include
   * @returns {Crc64Nvme} this instance
   */
  update(chunk) {
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);

    for (let index = 0; index < bytes.length; index += 1) {
      const tableValue = TABLE[(this.low ^ bytes[index]) & 0xff];
      const shiftedLow = ((this.low >>> 8) | ((this.high & 0xff) << 24)) >>> 0;
      const shiftedHigh = this.high >>> 8;
      this.low = (shiftedLow ^ tableValue.low) >>> 0;
      this.high = (shiftedHigh ^ tableValue.high) >>> 0;
    }

    return this;
  }

  digest() {
    const result = Buffer.allocUnsafe(8);
    result.writeUInt32BE((this.high ^ 0xffffffff) >>> 0, 0);
    result.writeUInt32BE((this.low ^ 0xffffffff) >>> 0, 4);
    return result;
  }

  toHex() {
    return this.digest().toString("hex").toUpperCase();
  }

  toBase64() {
    return this.digest().toString("base64");
  }
}

const crc64Nvme = (input) => new Crc64Nvme().update(input).toBase64();

module.exports = {
  Crc64Nvme,
  crc64Nvme,
};
