const { Crc64Nvme, crc64Nvme } = require("../../lib/utils/crc64nvme");

describe("CRC-64/NVME", () => {
  test("matches the published 123456789 check value", () => {
    const digest = new Crc64Nvme().update("123456789");

    expect(digest.toHex()).toBe("AE8B14860A799888");
    expect(digest.toBase64()).toBe("rosUhgp5mIg=");
    expect(crc64Nvme("123456789")).toBe("rosUhgp5mIg=");
  });

  test("produces the same digest across arbitrary chunk boundaries", () => {
    const input = Buffer.from("the same project bytes, streamed in pieces");
    const oneChunk = new Crc64Nvme().update(input).toBase64();
    const manyChunks = new Crc64Nvme()
      .update(input.subarray(0, 1))
      .update(input.subarray(1, 9))
      .update(input.subarray(9, 17))
      .update(input.subarray(17))
      .toBase64();

    expect(manyChunks).toBe(oneChunk);
  });

  test("accepts Uint8Array input and supports fluent updates", () => {
    const digest = new Crc64Nvme();

    expect(digest.update(new Uint8Array([49, 50, 51]))).toBe(digest);
    digest.update(Buffer.from("456789"));

    expect(digest.toHex()).toBe("AE8B14860A799888");
  });
});
