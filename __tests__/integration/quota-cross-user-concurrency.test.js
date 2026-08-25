/**
 * Real filesystem, real concurrent promise resolution (no fake timers, no
 * mocked fs.statfs): two different users' admission requests, each sized to
 * pass the disk-free floor alone but not together. Proves lib/upload-quota.js
 * checkUploadAllowed's disk-floor check is accounted globally (across every
 * currently-registered upload, not just the caller's own declared size) —
 * a property a synchronous/mocked-timing unit test cannot exercise, because
 * the bug it guards against only appears in the gap between the synchronous
 * admission-and-register section and the `await getFreeBytes()` after it.
 *
 * No Mongo needed here: quota accounting is in-process and filesystem-only.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

let directory;
let previousMinFreeBytes;

beforeAll(async () => {
  directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "komondor-it-quota-"),
  );
  previousMinFreeBytes = process.env.UPLOAD_MIN_FREE_BYTES;
});

afterAll(async () => {
  if (previousMinFreeBytes === undefined) {
    delete process.env.UPLOAD_MIN_FREE_BYTES;
  } else {
    process.env.UPLOAD_MIN_FREE_BYTES = previousMinFreeBytes;
  }
  await fs.promises.rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
  jest.resetModules();
});

const randomUploadId = () => crypto.randomBytes(16).toString("hex");

describe("checkUploadAllowed — the disk-free floor is accounted globally", () => {
  test("two users, each individually within the floor, are not both admitted when combined they are not", async () => {
    const quota = require("../../lib/upload-quota");

    // Measured via the SAME getFreeBytes the module itself uses, so this
    // scales correctly on whatever machine/CI runner actually runs it,
    // rather than guessing an absolute byte count that might not leave a
    // margin (or might not even fit on a small CI volume).
    const free = await quota.getFreeBytes(directory);
    if (free === null) {
      // fs.statfs is unavailable on this platform; the module already
      // documents this as "no opinion" rather than a failure. Nothing to
      // prove about a floor that cannot be measured.
      return;
    }

    // Each user's request alone leaves comfortably more than the floor;
    // together they leave comfortably less. Wide margins (10% of real free
    // space per side) so ordinary filesystem noise between the two
    // measurements below cannot flip the outcome.
    const sizeEach = Math.floor(free * 0.4);
    process.env.UPLOAD_MIN_FREE_BYTES = String(Math.floor(free * 0.3));

    quota.clearUploads();

    const idA = randomUploadId();
    const idB = randomUploadId();

    // Genuinely concurrent: both admission calls are in flight together
    // before either is awaited, matching how two independent HTTP requests
    // would actually arrive at routes/uploads.js's onUploadCreate.
    const [resultA, resultB] = await Promise.all([
      quota.checkUploadAllowed({
        id: idA,
        username: "alice",
        size: sizeEach,
        directory,
      }),
      quota.checkUploadAllowed({
        id: idB,
        username: "bob",
        size: sizeEach,
        directory,
      }),
    ]);

    const admitted = [resultA, resultB].filter((r) => r.allowed);
    const refused = [resultA, resultB].filter((r) => !r.allowed);

    // The bug this guards against: a per-call check of `free - ownSize`
    // alone admits BOTH, since neither request's own measurement of `free`
    // reflects the other's simultaneous reservation. Fixed accounting must
    // count the other's reservation too, so at most one may be admitted.
    expect(admitted.length).toBeLessThanOrEqual(1);
    expect(refused.length).toBeGreaterThanOrEqual(1);
    refused.forEach((r) => expect(r.status).toBe(507));

    // Whichever lost must not still hold a reservation afterwards.
    if (refused.length > 0) {
      const refusedId = resultA.allowed ? idB : idA;
      expect(quota.getUploadRecord(refusedId)).toBeUndefined();
    }
  });

  test("control: the same two requests are both admitted when the floor has room for both", async () => {
    const quota = require("../../lib/upload-quota");

    const free = await quota.getFreeBytes(directory);
    if (free === null) {
      return;
    }

    // This time the floor is set low enough that even the combined total
    // clears it — proves the refusal above is about the floor actually being
    // threatened, not about two concurrent requests always colliding.
    const sizeEach = Math.floor(free * 0.05);
    process.env.UPLOAD_MIN_FREE_BYTES = "0";

    quota.clearUploads();

    const [resultA, resultB] = await Promise.all([
      quota.checkUploadAllowed({
        id: randomUploadId(),
        username: "alice",
        size: sizeEach,
        directory,
      }),
      quota.checkUploadAllowed({
        id: randomUploadId(),
        username: "bob",
        size: sizeEach,
        directory,
      }),
    ]);

    expect(resultA.allowed).toBe(true);
    expect(resultB.allowed).toBe(true);
  });
});
