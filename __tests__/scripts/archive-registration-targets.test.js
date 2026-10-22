const path = require("path");
const fs = require("fs");
const { validateTargets } = require("../../lib/archive-registration");
const { parse } = require("../../scripts/register-archive-projects");
const folder = path.resolve("docs/archive/batches/2026-10-16/reconciliation-preview-2026-10-22");
const input = JSON.parse(fs.readFileSync(path.join(folder, "registration-targets.json")));

test("reviewed batch has exactly the approved 23 owners and roots, with source decision digests", () => {
  expect(validateTargets(input)).toBe(input);
  expect(input.targets).toHaveLength(23);
  const counts = input.targets.reduce((out, row) => { out[row.owner] = (out[row.owner] || 0) + 1; return out; }, {});
  expect(counts).toEqual({ shrestha: 18, winj: 5 });
  expect(input.targets.filter(t=>t.entryId.startsWith("skamoun-extra-")).every(t=>t.owner === "winj")).toBe(true);
  expect(input.targets.find(t=>t.entryId === "two_blades-003").relativePath).toBe("/two_blades/Courville");
  const hash = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(folder,"ownership-decisions.json"))).digest("hex");
  expect(input.targets.every(t=>t.sourceReference.ownershipDecisionsSha256 === hash)).toBe(true);
});

test.each(["/group/../escape", "/group/project/sub", "/group/project\n", "/group//project", "/group/.."])("refuses unsafe root %s", (relativePath) => {
  const changed = JSON.parse(JSON.stringify(input)); changed.targets[0].relativePath = relativePath;
  expect(()=>validateTargets(changed)).toThrow();
});
test("requires explicit execution and rejects typo/duplicate arguments", () => {
  expect(()=>parse(["apply","--work-dir","/tmp/evidence"])).toThrow("Required");
  expect(()=>parse(["prepare","--targets","one","--targets","two"])).toThrow("duplicate");
  expect(()=>parse(["inspect","project-id","abc"])).toThrow("named");
});
