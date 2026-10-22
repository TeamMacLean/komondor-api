// Only the reviewed administrative CLI inserts provenance/history, through the
// raw collection. Ordinary model/API writes cannot manufacture or replace it.
const protectedFields = ["registrationProvenance", "reconciliationHistory"];
const identityFields = ["name", "safeName", "path", "owner", "group"];
const touches = (field, root) => field === root || field.startsWith(root + ".");

function guardUpdate(update) {
  if (Array.isArray(update)) throw Error("Project pipeline updates are unsupported");
  const fields = Object.entries(update || {}).flatMap(([key, value]) => key.startsWith("$") ?
    [...Object.keys(value || {}), ...(key === "$rename" ? Object.values(value || {}) : [])] : [key]);
  if (fields.some((f) => typeof f === "string" && protectedFields.some((root) => touches(f, root)))) {
    throw Error("Registration provenance/history is administrative and append-only");
  }
  return fields.some((f) => typeof f === "string" && identityFields.some((root) => touches(f, root)));
}

function assertRegistrationIdentity(doc) {
  const registration = doc.registrationProvenance;
  if (!registration) return;
  if (registration.version !== 1 || !registration.identity || !registration.operationId) throw Error("Invalid registration provenance");
  for (const field of identityFields) {
    const actual = field === "group" ? doc.group?._id || doc.group : doc[field];
    if (String(actual) !== String(registration.identity[field])) throw Error(`Registered project ${field} is pinned; use a reviewed reconciliation`);
  }
  const parts = doc.path.split("/");
  if (parts.length !== 3 || parts[0] !== "" || parts[2] !== doc.safeName ||
      parts.some((part) => part === "." || part === "..") || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(doc.path)) {
    throw Error("Invalid registered physical root");
  }
}

function installRegistrationGuards(schema) {
  // Mongoose 5 bulkWrite does not run query/save middleware. Apply the same
  // fences here, then call its base implementation (not this overridden static).
  // Async also turns guard failures into rejections that Mongoose's static-hook
  // wrapper can deliver to callers; synchronous throws escape that wrapper.
  schema.statics.bulkWrite = async function (operations, options, callback) {
    const fence = (filter) => ({ $and: [filter || {}, { registrationProvenance: { $exists: false } }] });
    const guarded = operations.map((operation) => {
      if (operation.insertOne) {
        if (protectedFields.some((key) => operation.insertOne.document[key] !== undefined)) throw Error("Registration requires the administrative CLI");
        return operation;
      }
      const kind = Object.keys(operation)[0], body = operation[kind];
      if (["updateOne", "updateMany"].includes(kind)) {
        return guardUpdate(body.update) ? { [kind]: { ...body, filter: fence(body.filter) } } : operation;
      }
      if (kind === "replaceOne") guardUpdate(body.replacement);
      if (["replaceOne", "deleteOne", "deleteMany"].includes(kind)) return { [kind]: { ...body, filter: fence(body.filter) } };
      throw Error("Unsupported Project bulk operation");
    });
    return require("mongoose").Model.bulkWrite.call(this, guarded, options, callback);
  };
  schema.pre("insertMany", function (next, documents) {
    if (documents.some((doc) => protectedFields.some((field) => doc[field] !== undefined))) {
      return next(new Error("Registration provenance/history requires the administrative CLI"));
    }
    return next();
  });
  schema.pre("validate", function () {
    if (!this.isNew && !this.isSelected("registrationProvenance")) throw Error("Reload the full Project before saving");
    if (protectedFields.some((field) => this.isModified(field))) throw Error("Registration provenance/history is administrative and append-only");
    assertRegistrationIdentity(this);
  });
  // save({validateBeforeSave:false}) must not bypass the protection.
  schema.pre("save", function () {
    if (!this.isNew && !this.isSelected("registrationProvenance")) throw Error("Reload the full Project before saving");
    if (protectedFields.some((field) => this.isModified(field))) throw Error("Registration provenance/history is administrative and append-only");
    assertRegistrationIdentity(this);
  });
  for (const operation of ["update", "updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"]) {
    schema.pre(operation, function () {
      const changesIdentity = guardUpdate(this.getUpdate());
      if (operation.includes("eplace") || this.getOptions().overwrite ||
          changesIdentity) {
        // An atomic filter prevents a race with registration. Metadata/storage
        // updates still work; identity changes cannot silently lose provenance.
        this.where({ registrationProvenance: { $exists: false } });
      }
    });
  }
  for (const operation of ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove", "remove"]) {
    schema.pre(operation, { query: true, document: false }, function () {
      this.where({ registrationProvenance: { $exists: false } });
    });
  }
  for (const operation of ["deleteOne", "remove"]) {
    schema.pre(operation, { document: true, query: false }, async function () {
      // Check the stored row too: a projection may have omitted provenance.
      if (await this.constructor.exists({ _id: this._id, registrationProvenance: { $exists: true } })) {
        throw Error("Retain registered project history; use reviewed retirement");
      }
    });
  }
}
module.exports = { assertRegistrationIdentity, installRegistrationGuards };
