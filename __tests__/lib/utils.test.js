const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { calculateFileMd5 } = require("../../lib/utils/md5");

describe("MD5 Utility (calculateFileMd5)", () => {
  const testFilePath = path.join(__dirname, "temp-test-file.txt");
  const testFileContent = "hello komondor";
  let expectedMd5;

  // Create a temporary file and calculate the expected MD5 before running tests
  beforeAll(async () => {
    await fs.writeFile(testFilePath, testFileContent);
    // Programmatically calculate the expected hash to avoid manual errors
    expectedMd5 = crypto
      .createHash("md5")
      .update(testFileContent)
      .digest("hex");
  });

  // Clean up the temporary file after tests
  afterAll(async () => {
    await fs.unlink(testFilePath);
  });

  it("should correctly calculate the MD5 checksum for a given file", async () => {
    const md5 = await calculateFileMd5(testFilePath);
    expect(md5).toBe(expectedMd5);
  });

  it("should reject the promise if the file does not exist", async () => {
    const nonExistentFilePath = path.join(__dirname, "non-existent-file.txt");

    // Suppress the expected console.error for this specific test case
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // We expect this promise to be rejected and assert that it throws an error.
    await expect(calculateFileMd5(nonExistentFilePath)).rejects.toThrow();

    // Restore the original console.error implementation
    consoleErrorSpy.mockRestore();
  });
});
