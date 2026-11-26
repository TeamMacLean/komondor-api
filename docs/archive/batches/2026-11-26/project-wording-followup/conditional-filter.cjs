'use strict';
// Typed compare-and-set filter reused from the verified Gulnara MD5 importer.
// Empty new-field lists omit $and, because MongoDB forbids an empty $and.
const assert=require('node:assert/strict');
const plain=x=>x && Object.getPrototypeOf(x)===Object.prototype;
const TYPED={promoteValues:false,promoteLongs:false,promoteBuffers:false};
function bsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (Buffer.isBuffer(value)) return "binData";
  if (value?._bsontype) {
    const types = {
      ObjectID: "objectId",
      ObjectId: "objectId",
      Int32: "int",
      Long: "long",
      Double: "double",
      Decimal128: "decimal",
      Binary: "binData",
      Timestamp: "timestamp",
      BSONRegExp: "regex",
      MinKey: "minKey",
      MaxKey: "maxKey",
    };
    assert(types[value._bsontype], "Unsupported BSON type");
    return types[value._bsontype];
  }
  if (plain(value)) return "object";
  const t = {
    string: "string",
    boolean: "bool",
    number: "double",
    undefined: "undefined",
  }[typeof value];
  assert(t, "Unsupported BSON value");
  return t;
}
function typedExpression(value, expression) {
  const checks = [{ $eq: [{ $type: expression }, bsonType(value)] }];
  if (plain(value)) {
    checks.push({
      $eq: [
        {
          $map: {
            input: { $objectToArray: expression },
            as: "kv",
            in: "$$kv.k",
          },
        },
        { $literal: Object.keys(value) },
      ],
    });
    for (const [key, child] of Object.entries(value)) {
      const childExpression = {
        $arrayElemAt: [
          {
            $map: {
              input: {
                $filter: {
                  input: { $objectToArray: expression },
                  as: "kv",
                  cond: { $eq: ["$$kv.k", { $literal: key }] },
                },
              },
              as: "kv",
              in: "$$kv.v",
            },
          },
          0,
        ],
      };
      checks.push(typedExpression(child, childExpression));
    }
  } else if (Array.isArray(value)) {
    checks.push({ $eq: [{ $size: expression }, value.length] });
    value.forEach((child, i) =>
      checks.push(typedExpression(child, { $arrayElemAt: [expression, i] }))
    );
  }
  return { $and: checks };
}
function wholeDocumentFilter(before, newFields) {
  return {
    _id: before._id,
    ...(newFields.filter(k => !Object.hasOwn(before,k)).length ? {$and: newFields.filter(k=>!Object.hasOwn(before,k)).map(k=>({[k]:{$exists:false}}))} : {}),
    $expr: {
      $and: [
        { $eq: ["$$ROOT", { $literal: before }] },
        typedExpression(before, "$$ROOT"),
      ],
    },
  };
}
module.exports={wholeDocumentFilter,TYPED};
