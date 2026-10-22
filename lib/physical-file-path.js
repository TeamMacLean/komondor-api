const fs = require("fs").promises;
const path = require("path");

function normalized(value) {
  if (typeof value !== "string" || !value || /[\\\0\r\n]/.test(value)) return null;
  const clean = value.replace(/^\//, "");
  if (clean.split("/").some(p => !p || p === "." || p === "..")) return null;
  return clean;
}
function relativeTo(root, value) {
  const r = normalized(root), p = normalized(value);
  return r && p && p.startsWith(r + "/") ? p.slice(r.length + 1) : null;
}
async function resolvePhysicalFile(datastoreRoot, projectRoot, storedPath) {
  const relative = relativeTo(projectRoot, storedPath);
  if (!relative) throw Error("Stored file path is absent or outside its project");
  const root = path.resolve(datastoreRoot), absolute = path.join(root, normalized(storedPath));
  if (await fs.realpath(root) !== root) throw Error("Datastore root is not canonical");
  // Refuse every symlink, including links which happen to remain within the tree.
  let current = root;
  for (const segment of normalized(storedPath).split("/")) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error("Stored file path contains a symlink");
  }
  if (!(await fs.lstat(absolute)).isFile() || await fs.realpath(absolute) !== absolute) throw Error("Stored path is not a canonical regular file");
  return absolute;
}
function fileUri(project, file) {
  const relative = relativeTo(project?.path, file?.path);
  if (!relative) return null;
  const { resolveStorageState, appendUri } = require("./storage-state");
  const state = resolveStorageState(project);
  if (state.authoritativeLocation === "s3") return appendUri(project.storage.s3Uri, relative);
  if (state.authoritativeLocation === "hpc") return path.posix.join(process.env.READS_ROOT_PATH || "/tsl/data/reads", normalized(file.path));
  return null;
}
function attachFileLocations(records, project) {
  for (const record of records || []) if (record?.file && typeof record.file === "object") {
    const uri = fileUri(project, record.file);
    if (typeof record.file.set === "function") record.file.set("locationUri", uri, { strict: false });
    else record.file.locationUri = uri;
  }
}
module.exports = { normalized, relativeTo, resolvePhysicalFile, fileUri, attachFileLocations };
