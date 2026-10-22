// Administrative corrections use raw, conditional writes with retained BSON
// before-images. Normal application writers cannot manufacture that authority.
const mongoose = require("mongoose");
const fields = ["reconciliation", "reconciliationHistory"];
const active = { "reconciliation.retiredAt": { $exists: false } };
const uncorrected = { reconciliation: { $exists: false } };
const and = (filter, fence) => ({ $and: [filter || {}, fence] });
const isAdministrative = (key) => fields.some(f => key === f || key.startsWith(f + "."));

function assertPinned(doc) {
  const state = doc.reconciliation;
  if (!state) return;
  if (state.version !== 1 || !state.operationId) throw Error("Invalid reconciliation state");
  if (state.retiredAt) throw Error("Retired records require reviewed reactivation");
  for (const [key, expected] of Object.entries(state.identity || {})) {
    const actual = doc[key]?._id || doc[key];
    if (String(actual) !== String(expected)) throw Error(`Reconciled ${key} is pinned; use reviewed correction`);
  }
}

function guardUpdate(update) {
  if (Array.isArray(update)) throw Error("Pipeline updates require administrative review");
  const keys = Object.entries(update || {}).flatMap(([k,v]) => k.startsWith("$")
    ? [...Object.keys(v || {}), ...(k === "$rename" ? Object.values(v || {}) : [])] : [k]);
  if (keys.some(k => typeof k === "string" && isAdministrative(k))) throw Error("Reconciliation history is administrative and append-only");
  return keys;
}

function installReconciliationGuards(schema) {
  schema.add({ reconciliation: mongoose.Schema.Types.Mixed });
  if (!schema.path("reconciliationHistory")) schema.add({
    reconciliationHistory: { type: [mongoose.Schema.Types.Mixed], default: undefined, select: false },
  });
  const previousTransform = schema.options.toJSON?.transform;
  schema.set("toJSON", { ...schema.options.toJSON, transform(doc, ret, options) {
    const result = previousTransform ? previousTransform(doc, ret, options) || ret : ret;
    // The small public status is useful; private evidence and before-images are not.
    if (result.reconciliation) result.catalogue = {
      retrospective: true, classification: result.reconciliation.classification || null,
      classificationBasis: result.reconciliation.classificationBasis || null,
    };
    delete result.reconciliation;
    delete result.reconciliationHistory;
    return result;
  } });
  for (const operation of ["find", "findOne", "count", "countDocuments", "distinct"]) {
    schema.pre(operation, function () { this.setQuery(and(this.getQuery(), active)); });
  }
  schema.pre("aggregate", function () {
    const stages = this.pipeline();
    // A geo query must remain first. It is not used by Komondor but need not be broken.
    stages.splice(stages[0]?.$geoNear ? 1 : 0, 0, { $match: active });
  });
  for (const operation of ["validate", "save"]) schema.pre(operation, function () {
    if (!this.isNew && !this.isSelected("reconciliation")) throw Error("Reload the full record before saving");
    if (fields.some(f => this.isModified(f))) throw Error("Reconciliation history is administrative and append-only");
    assertPinned(this);
  });
  schema.pre("insertMany", function (next, documents) {
    next(documents.some(d => fields.some(f => d[f] !== undefined)) ? Error("Reconciliation requires administrative tooling") : undefined);
  });
  for (const operation of ["update", "updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"]) {
    schema.pre(operation, function () {
      const keys = guardUpdate(this.getUpdate());
      // Corrected paths/relationships are frozen for ordinary writers. Other
      // fields (including storage state) retain their existing API behaviour.
      const identities = ["path", "name", "safeName", "owner", "group", "project", "sample", "run", "file", "originalName"];
      const fence = operation.includes("eplace") || this.getOptions().overwrite ||
        keys.some(k => identities.some(f => k === f || k.startsWith(f + "."))) ? and(active, uncorrected) : active;
      this.setQuery(and(this.getQuery(), fence));
    });
  }
  for (const operation of ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove", "remove"]) {
    schema.pre(operation, { query: true, document: false }, function () {
      this.setQuery(and(this.getQuery(), and(active, uncorrected)));
    });
  }
  for (const operation of ["deleteOne", "remove"]) schema.pre(operation, { query: false, document: true }, async function () {
    if (await this.constructor.collection.findOne({ _id: this._id, reconciliation: { $exists: true } })) {
      throw Error("Retain reconciliation history; deletion requires administrative review");
    }
  });
  const previousBulk = schema.statics.bulkWrite;
  schema.statics.bulkWrite = async function (operations, options, callback) {
    const guarded = operations.map(op => {
      const kind = Object.keys(op)[0], body = op[kind];
      if (kind === "insertOne") {
        if (fields.some(f => body.document[f] !== undefined)) throw Error("Reconciliation requires administrative tooling");
        return op;
      }
      if (!["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"].includes(kind)) throw Error("Unsupported bulk operation");
      if (body.update || body.replacement) guardUpdate(body.update || body.replacement);
      // Conservative for batch writes: none may mutate an administratively corrected row.
      return { [kind]: { ...body, filter: and(body.filter, and(active, uncorrected)) } };
    });
    return (previousBulk || mongoose.Model.bulkWrite).call(this, guarded, options, callback);
  };
}
module.exports = { installReconciliationGuards, assertPinned, active };
