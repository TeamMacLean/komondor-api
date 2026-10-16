const {
  parseCsv,
  parseArgs,
  projectPathFromDisplay,
  verdictFor,
} = require("../../scripts/archive-shortlist-verify");

describe("archive shortlist verification helpers", () => {
  test("rejects ambiguous invocations and malformed or empty identity input", () => {
    expect(() => parseArgs(["--group", "a", "--csv", "x"])).toThrow(/exactly one/);
    expect(() => parseArgs(["--group", "a", "--group", "b"])).toThrow(/Repeated/);
    expect(() => parseArgs(["--group", "a", "--decision", "KEEP"])).toThrow(/requires --csv/);
    expect(() => parseArgs(["--typo", "a"])).toThrow(/Unexpected/);
    expect(() => parseCsv('hpc_path\n"unterminated')).toThrow(/Unterminated/);
    expect(() => parseCsv('hpc_path,hpc_path\na,b')).toThrow(/Duplicate/);
    expect(() => parseCsv('group,hpc_path\na,b,c')).toThrow(/length/);
    expect(parseCsv('')).toEqual([]);
    expect(() => projectPathFromDisplay('')).toThrow(/non-empty/);
  });
  test("parses quoted CSV fields with embedded commas and quotes", () => {
    const rows = parseCsv(
      'group,project,hpc_path\r\ntwo_blades,"foc, cr1 ""x""",/tsl/data/reads/two_blades/foc_cr1_\n',
    );
    expect(rows).toEqual([
      {
        group: "two_blades",
        project: 'foc, cr1 "x"',
        hpc_path: "/tsl/data/reads/two_blades/foc_cr1_",
      },
    ]);
  });

  test("maps a display path to the stored Project.path", () => {
    expect(projectPathFromDisplay("/tsl/data/reads/skamoun/rice_blast/")).toBe(
      "/skamoun/rice_blast",
    );
    expect(projectPathFromDisplay("/skamoun/rice_blast")).toBe(
      "/skamoun/rice_blast",
    );
    expect(projectPathFromDisplay('/ifs/apricot/TSL/PrimaryData/DATABASES/reads/two_blades/Courville')).toBe('/two_blades/Courville');
    expect(parseCsv('\uFEFFhpc_path\n/group/project')[0]).toEqual({ hpc_path: '/group/project' });
  });

  test("classifies the disk-versus-database cases that matter", () => {
    const base = { status: "ok", dbReads: 3, dbAdditionalFiles: 0 };
    expect(
      verdictFor({
        ...base,
        summary: {
          diskRegularFiles: 0,
          dbRecordsMissingOnDisk: 3,
          diskFilesNotInDb: 0,
        },
      }),
    ).toBe("DB_SAYS_FILES_DISK_EMPTY");
    expect(
      verdictFor({
        ...base,
        summary: {
          diskRegularFiles: 2,
          dbRecordsMissingOnDisk: 1,
          diskFilesNotInDb: 0,
        },
      }),
    ).toBe("DB_RECORDS_MISSING_ON_DISK");
    expect(
      verdictFor({
        status: "ok",
        dbReads: 0,
        dbAdditionalFiles: 0,
        summary: {
          diskRegularFiles: 2,
          dbRecordsMissingOnDisk: 0,
          diskFilesNotInDb: 2,
        },
      }),
    ).toBe("DISK_FILES_NO_DB_RECORDS");
    expect(
      verdictFor({
        ...base,
        summary: {
          diskRegularFiles: 4,
          dbRecordsMissingOnDisk: 0,
          diskFilesNotInDb: 1,
        },
      }),
    ).toBe("OK_WITH_UNTRACKED_FILES");
    expect(verdictFor({ status: "NO_DIRECTORY" })).toBe("NO_DIRECTORY");
    expect(verdictFor({ ...base, hardBlockers: ['Run is processing'],
      summary: { diskRegularFiles: 2 } })).toBe('ACTIVE_WORK');
    expect(verdictFor({ ...base, summary: { diskRegularFiles: 2,
      dbRecordsMissingOnDisk: 0, diskFilesNotInDb: 0, seriousAnomalies: 3 } })).toBe('ANOMALIES_REQUIRE_REVIEW');
  });
});
