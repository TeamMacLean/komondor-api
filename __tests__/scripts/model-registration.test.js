// Both operator scripts populate Read.file and AdditionalFile.file through
// lib/s3-archive/preflight. In the API process another module registers the
// File model first; a standalone script must register it itself or every
// populate fails with MissingSchemaError on the production host.
describe("operator scripts register every model they populate", () => {
  test.each([
    "../../scripts/move-project-to-s3",
    "../../scripts/archive-shortlist-verify",
  ])(
    "%s registers File, Read, AdditionalFile, Run, Sample, Project",
    (script) => {
      let names, autoIndex, autoCreate;
      jest.isolateModules(() => {
        require(script);
        // The isolated registry's own mongoose instance, which is the one the
        // script's models were compiled against.
        names = require("mongoose").modelNames();
        autoIndex = require("mongoose").get("autoIndex");
        autoCreate = require("mongoose").get("autoCreate");
      });
      for (const model of [
        "File",
        "Read",
        "AdditionalFile",
        "Run",
        "Sample",
        "Project",
      ]) {
        expect(names).toContain(model);
      }
      expect(autoIndex).toBe(false);
      expect(autoCreate).toBe(false);
    },
  );
});
