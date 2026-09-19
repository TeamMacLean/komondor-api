const { verificationSummary } = require("../../lib/verification-summary");
const run = { status: "complete", md5VerificationStatus: "complete" };
test("a legacy complete status cannot hide a mismatch", () => {
  expect(
    verificationSummary(run, [{ MD5: "a", destinationMd5: "b" }]).state,
  ).toBe("mismatch");
});
test("passing requires matching destination checksums for every read", () => {
  expect(
    verificationSummary(run, [{ MD5: "abc", destinationMd5: "ABC" }]).state,
  ).toBe("passed");
  expect(verificationSummary(run, [{ MD5: "abc" }]).state).toBe("failed");
});
test("skipped verification is explicit", () => {
  expect(
    verificationSummary({ ...run, md5VerificationResult: { disabled: true } })
      .state,
  ).toBe("skipped");
  expect(verificationSummary(run, [{}]).state).toBe("skipped");
});
test("background verification stays unfinished after ingest completes", () => {
  expect(
    verificationSummary({ ...run, md5VerificationStatus: "pending" }, [
      { MD5: "a" },
    ]).state,
  ).toBe("pending");
});
test("an active retry does not finish based on stale mismatch data", () => {
  expect(
    verificationSummary({ ...run, md5VerificationStatus: "in_progress" }, [
      { MD5: "a", destinationMd5: "b", md5Mismatch: true },
    ]).state,
  ).toBe("in_progress");
});
