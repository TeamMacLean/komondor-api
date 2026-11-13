const { parsePreservationDate, resolveHpcPreservation } = require("../../lib/hpc-preservation");
const Project = require("../../models/Project");

describe("HPC preservation dates", () => {
  const until = "2027-11-13T23:59:59.999Z";

  test("supports a canonical UTC timestamp or explicit removal", () => {
    expect(parsePreservationDate(until)).toEqual(new Date(until));
    expect(parsePreservationDate(null)).toBeNull();
    expect(parsePreservationDate("2028-02-29T00:00:00.000Z")).toEqual(new Date("2028-02-29T00:00:00.000Z"));
  });

  test.each([
    undefined, "", false, 0, {}, [], "2027-11-13", "2027-11-13T23:59:59Z",
    "2027-11-13T23:59:59.999+00:00", "2027-02-29T00:00:00.000Z",
    "2027-04-31T00:00:00.000Z", "2027-11-13T24:00:00.000Z",
  ])("rejects invalid or ambiguous input %p", (value) => {
    expect(() => parsePreservationDate(value)).toThrow(TypeError);
  });

  test("a hold protects up to its exact deadline and permits review at expiry", () => {
    const project = { preserveOnHpcUntil: new Date(until) };
    expect(resolveHpcPreservation(project, "2027-11-13T23:59:59.998Z")).toEqual({
      until, active: true, invalid: false,
    });
    expect(resolveHpcPreservation(project, until)).toEqual({ until, active: false, invalid: false });
    expect(resolveHpcPreservation(project, "2028-01-01T00:00:00.000Z")).toEqual({ until, active: false, invalid: false });
  });

  test.each([{}, { preserveOnHpcUntil: null }])("legacy or cleared policy is inactive", (project) => {
    expect(resolveHpcPreservation(project)).toEqual({ until: null, active: false, invalid: false });
  });

  test.each(["invalid", "2027-02-29T00:00:00.000Z", false, 0, {}, new Date(NaN)])(
    "does not silently treat malformed stored policy %p as no hold", (value) => {
      expect(resolveHpcPreservation({ preserveOnHpcUntil: value })).toEqual({ until: null, active: false, invalid: true });
    },
  );

  test("Mongoose cast failures remain invalid when hydration omitted the bad value", () => {
    const project = Project.hydrate({ _id: "64f1c0000000000000000000", preserveOnHpcUntil: "invalid" });
    expect(resolveHpcPreservation(project).invalid).toBe(true);
  });

  test("public Project JSON includes the date but hides its administrative audit", () => {
    const project = Project.hydrate({
      _id: "64f1c0000000000000000000", preserveOnHpcUntil: until,
      hpcPreservationHistory: [{ at: new Date(), by: "admin", previousUntil: null, until }],
    });
    const json = JSON.parse(JSON.stringify(project));
    expect(json.preserveOnHpcUntil).toBe(until);
    expect(json).not.toHaveProperty("hpcPreservationHistory");
    expect(Project.schema.path("hpcPreservationHistory").options.select).toBe(false);
    expect(Project.hydrate({ _id: "64f1c0000000000000000001" }).toJSON().preserveOnHpcUntil).toBeNull();
  });
});
