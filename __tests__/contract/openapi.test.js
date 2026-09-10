const fs = require("fs");
const _path = require("path");

/**
 * Guards openapi.yaml against silent rot.
 *
 * The spec is the contract three sibling repos build against (komondor-web,
 * komondor-power, komondor-nudge), and a spec that quietly stops matching the
 * server is worse than no spec: consumers write against documented behaviour
 * that no longer exists. So every route the server actually registers must
 * have an entry, and every documented path must be a route.
 *
 * DEPENDENCY-FREE ON PURPOSE. No swagger-parser, no js-yaml — adding a
 * dependency to a repo whose audit already reports 4 critical / 41 high is not
 * a trade worth making for a structural check.
 *
 * That costs some strength, and the cost is worth stating plainly:
 *
 *   - Routes are read from the LIVE express routers, not by pattern-matching
 *     source. Requiring routes/*.js and walking `router.stack` is exact: it
 *     sees paths registered through helpers (`registerOptionRoutes`,
 *     `registerEntitySearch`) that no regex over the source would catch.
 *   - The YAML side is read with a narrow line scanner that only extracts the
 *     keys under `paths:` and the HTTP verbs beneath each. It is not a YAML
 *     parser and would be fooled by a `paths:` block written in flow style or
 *     with unusual indentation. It is sufficient because it only has to
 *     understand the file in this repo, and `parses openapi.yaml` below
 *     asserts the shape it depends on.
 */

const REPO_ROOT = _path.join(__dirname, "..", "..");
const ROUTES_DIR = _path.join(REPO_ROOT, "routes");
const SPEC_PATH = _path.join(REPO_ROOT, "openapi.yaml");

// The tus upload server is attached with `router.use("/uploads", uploadApp)`,
// which produces a mount layer with a regexp rather than a route layer. Rather
// than reverse-engineer that regexp — brittle, and it changes between express
// versions — the mount is named here and asserted separately.
const MOUNTED_SUBAPPS = ["/uploads"];

// Not real HTTP verbs to document. Express registers HEAD alongside every GET,
// and records a `_all` pseudo-method on any route built with `.all()` — which
// is how nearly every route here attaches `isAuthenticated`.
const IGNORED_METHODS = new Set(["head", "_all"]);

/**
 * Loads every express router under routes/ and reads back what it registered.
 *
 * @returns {Map<string, Set<string>>} Express path to the set of HTTP methods.
 */
const collectRegisteredRoutes = () => {
  const registered = new Map();

  const add = (path, methods) => {
    if (!registered.has(path)) {
      registered.set(path, new Set());
    }
    const bucket = registered.get(path);
    Object.keys(methods)
      .filter((method) => methods[method] && !IGNORED_METHODS.has(method))
      .forEach((method) => bucket.add(method));
  };

  // `.route` is present on a layer created by router.get/post/route(); a
  // middleware or mount layer has none, and is skipped.
  const walkStack = (stack) => {
    (stack || []).forEach((layer) => {
      if (layer.route && layer.route.path) {
        add(layer.route.path, layer.route.methods || {});
      }
    });
  };

  fs.readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".js"))
    // _utils.js exports helpers, not a router. Requiring it is harmless but
    // it has no stack to walk.
    .forEach((name) => {
      const mod = require(_path.join(ROUTES_DIR, name));
      walkStack(mod && mod.stack);
    });

  // /health and /ready are registered on the app itself rather than in a
  // router, so they are invisible to the loop above.
  const app = require(_path.join(REPO_ROOT, "app"));
  walkStack(app._router && app._router.stack);

  return registered;
};

/**
 * Rewrites an express path as an OpenAPI one: `/runs/:id/status` becomes
 * `/runs/{id}/status`.
 *
 * @param {string} path - An express route path.
 * @returns {string} The OpenAPI equivalent.
 */
const toSpecPath = (path) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

/**
 * Extracts the `paths:` section of openapi.yaml.
 *
 * Deliberately narrow: it walks the file line by line, finds the top-level
 * `paths:` key, then reads the two-space-indented `/…:` keys under it and the
 * four-space-indented HTTP verbs under those, stopping at the next top-level
 * key. See the note at the top of this file about what that does not cover.
 *
 * @param {string} yaml - The raw file contents.
 * @returns {Map<string, Set<string>>} Spec path to the set of documented methods.
 */
const parseSpecPaths = (yaml) => {
  const paths = new Map();
  const lines = yaml.split("\n");

  const HTTP_METHODS = new Set([
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
  ]);

  let inPaths = false;
  let current = null;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }

    if (!inPaths) {
      continue;
    }

    // A non-indented, non-blank line ends the section.
    if (/^\S/.test(line)) {
      break;
    }

    const pathMatch = line.match(/^ {2}(\/\S*?):\s*$/);
    if (pathMatch) {
      current = pathMatch[1];
      paths.set(current, new Set());
      continue;
    }

    const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
    if (methodMatch && current && HTTP_METHODS.has(methodMatch[1])) {
      paths.get(current).add(methodMatch[1]);
    }
  }

  return paths;
};

describe("openapi.yaml contract", () => {
  let registered;
  let spec;
  let specText;

  beforeAll(() => {
    specText = fs.readFileSync(SPEC_PATH, "utf8");
    spec = parseSpecPaths(specText);
    registered = collectRegisteredRoutes();
  });

  describe("the spec itself", () => {
    test("declares OpenAPI 3.1", () => {
      expect(specText).toMatch(/^openapi:\s*3\.1\.\d+\s*$/m);
    });

    // Everything below trusts parseSpecPaths. If the file is ever restructured
    // in a way the scanner cannot read, it would silently find zero paths and
    // every other assertion here would pass vacuously.
    test("parses into a non-trivial set of paths", () => {
      expect(spec.size).toBeGreaterThan(20);
      for (const path of spec.keys()) {
        expect(path.startsWith("/")).toBe(true);
      }
    });

    test("documents no /api prefix — routers are mounted at the root", () => {
      const prefixed = [...spec.keys()].filter((path) =>
        path.startsWith("/api"),
      );
      expect(prefixed).toEqual([]);
    });

    /**
     * Without a YAML parser this suite cannot prove the file is well-formed,
     * but it can rule out the one mistake that actually happened while writing
     * it — twice. An unquoted scalar containing ": " is read as a nested
     * mapping, so
     *
     *     description: Sets `deleted: false`. The inverse of /groups/delete.
     *
     * is a syntax error, not a sentence, and every line-based check above
     * still passes on it. Quote the value or make it a `|` block.
     */
    test("no unquoted scalar contains a colon-space", () => {
      const offenders = [];

      specText.split("\n").forEach((line, index) => {
        const match = line.match(
          /^\s*(description|summary|detail|message):\s+(\S.*)$/,
        );
        if (!match) {
          return;
        }

        const value = match[2].trimEnd();

        // Block scalars, quoted scalars, refs and anchors are all fine.
        if (/^[|>'"&*$]/.test(value)) {
          return;
        }

        if (value.includes(": ") || value.endsWith(":")) {
          offenders.push(`line ${index + 1}: ${value.slice(0, 60)}`);
        }
      });

      expect(offenders).toEqual([]);
    });

    test("every $ref points at something defined in this file", () => {
      const refs = [...specText.matchAll(/\$ref:\s*"([^"]+)"/g)].map(
        (match) => match[1],
      );

      expect(refs.length).toBeGreaterThan(0);

      const unresolved = refs.filter((ref) => {
        if (!ref.startsWith("#/")) {
          // No external documents: the spec is meant to be self-contained so
          // consumers can vendor the single file.
          return true;
        }

        // A component name is unique enough in this file that finding its
        // heading is a sound existence check without parsing the tree.
        const name = ref.split("/").pop();
        return !specText.includes(`\n    ${name}:\n`);
      });

      expect([...new Set(unresolved)].sort()).toEqual([]);
    });
  });

  describe("every registered route is documented", () => {
    test("finds routes to check", () => {
      // Guards against the router walk silently returning nothing, which would
      // make the two tests below pass without checking anything.
      expect(registered.size).toBeGreaterThan(20);
    });

    test("every express path has a path entry", () => {
      const missing = [...registered.keys()]
        .map(toSpecPath)
        .filter((path) => !spec.has(path))
        .sort();

      expect(missing).toEqual([]);
    });

    test("every express method has an operation entry", () => {
      const missing = [];

      for (const [expressPath, methods] of registered) {
        const specPath = toSpecPath(expressPath);
        const documented = spec.get(specPath);

        if (!documented) {
          // Reported by the previous test; not repeated here.
          continue;
        }

        for (const method of methods) {
          if (!documented.has(method)) {
            missing.push(`${method.toUpperCase()} ${specPath}`);
          }
        }
      }

      expect(missing.sort()).toEqual([]);
    });

    test("the tus upload sub-app is documented", () => {
      // router.use() mounts leave no route layer, so this one is checked by
      // name. See MOUNTED_SUBAPPS.
      MOUNTED_SUBAPPS.forEach((mount) => {
        expect(spec.has(mount)).toBe(true);
      });
    });
  });

  describe("the spec documents nothing that does not exist", () => {
    test("every documented path is a registered route", () => {
      const expressPaths = new Set([...registered.keys()].map(toSpecPath));

      const fictional = [...spec.keys()]
        .filter((path) => !expressPaths.has(path))
        .filter((path) => !MOUNTED_SUBAPPS.includes(path))
        .sort();

      expect(fictional).toEqual([]);
    });
  });

  describe("drift the spec exists to pin down", () => {
    // These are the behaviours the sibling repos got wrong, listed in
    // docs/CONTRACTS.md. Each one is a place where deleting the documentation
    // would let the misunderstanding return unnoticed, so the presence of the
    // entry is asserted rather than left to review.

    test("login is at /login, not /auth/login", () => {
      expect(spec.has("/login")).toBe(true);
      expect(spec.has("/auth/login")).toBe(false);
    });

    test("the idempotent-create endpoints document both 200 and 201", () => {
      // Read from the raw text rather than the path scanner: response codes
      // sit two levels below the verb and are outside what it extracts.
      ["/samples/new", "/runs/new"].forEach((path) => {
        const section = sectionFor(specText, `  ${path}:`);
        expect(section).toContain('"200"');
        expect(section).toContain('"201"');
      });
    });

    test("Project.nudgeable is documented as group-derived, not hard-coded", () => {
      // This used to assert the spec mentioned the hard-coded '2Blades' group
      // id. That literal is gone from routes/projects.js, so the old regex
      // still passed while pinning documentation of behaviour that no longer
      // exists. The derivation is now Group.sendToEna.
      expect(specText).toMatch(/nudgeable[\s\S]{0,2000}?sendToEna === true/);
      expect(specText).not.toContain("5fc012bda3efcb29338b7cf3");
    });

    test("PUT /project/toggle-nudgeable is documented as group-authorised", () => {
      // The route was the one that honoured a client value with no group
      // check at all; the spec described that as a DEFECT. It now requires
      // write access, so a 403 must be a documented outcome.
      const section = sectionFor(specText, "  /project/toggle-nudgeable:");
      expect(section).toContain('"403"');
      expect(section).not.toContain("no authorisation beyond");
    });

    test("Group.deleted is documented as a soft-delete flag", () => {
      expect(specText).toMatch(/deleted:[\s\S]{0,400}?SOFT-DELETE FLAG/);
    });

    test("the run status enums are documented in full", () => {
      const runStatus = sectionFor(specText, "    RunStatus:");
      ["pending", "processing", "complete", "error"].forEach((value) => {
        expect(runStatus).toContain(`- ${value}`);
      });

      const md5 = sectionFor(specText, "    Md5VerificationStatus:");
      ["pending", "in_progress", "complete", "failed"].forEach((value) => {
        expect(md5).toContain(`- ${value}`);
      });
    });

    test("LibraryType.indexed is documented", () => {
      const libraryType = sectionFor(specText, "    LibraryType:");
      expect(libraryType).toContain("indexed:");
    });

    test("the error envelope documents error, detail and requestId", () => {
      const envelope = sectionFor(specText, "    ErrorEnvelope:");
      expect(envelope).toContain("error:");
      expect(envelope).toContain("detail:");
      expect(envelope).toContain("requestId:");
    });

    test("the bearer scheme documents the mandatory exp claim", () => {
      const scheme = sectionFor(specText, "    bearerAuth:");
      expect(scheme).toMatch(/exp/);
      expect(scheme).toMatch(/mandatory/i);
    });
  });
});

/**
 * Returns the block of YAML introduced by `heading`, up to the next line at the
 * same or lower indentation.
 *
 * The heading must be given verbatim, indentation included — the child
 * indentation is derived from it. Passing the indent separately was a bug: the
 * two are not the same number (a schema heading sits at four spaces and its
 * properties at six), and using one for the other silently returned "", which
 * every `toContain` below then reported as a missing key rather than a broken
 * helper.
 *
 * @param {string} text - The whole file.
 * @param {string} heading - The literal heading line, e.g. "    LibraryType:".
 * @returns {string} The block, or "" when the heading is absent.
 */
function sectionFor(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === heading);
  if (start === -1) {
    return "";
  }

  const indent = heading.length - heading.trimStart().length;
  const childPrefix = " ".repeat(indent + 1);

  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== "" && !line.startsWith(childPrefix)) {
      break;
    }
    out.push(line);
  }

  return out.join("\n");
}
