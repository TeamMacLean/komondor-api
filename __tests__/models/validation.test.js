/**
 * Tests for the name guards in the Project and Run pre-validate hooks.
 *
 * Those hooks run *before* mongoose checks required fields, and both called
 * `this.name.replace(...)` unconditionally. A document with no name therefore
 * threw a bare TypeError out of the hook, which reached the client as an
 * opaque 500 rather than a validation message naming the field.
 */

const mongoose = require("mongoose");

const Project = require("../../models/Project");
const Run = require("../../models/Run");

afterAll(async () => {
  await mongoose.connection.close();
});

describe.each([
  ["Project", () => Project],
  ["Run", () => Run],
])("%s validation with no name", (name, getModel) => {
  test.each([[undefined], [null], [""]])(
    "reports a validation error rather than throwing for name %p",
    async (badName) => {
      const doc = new (getModel())({ name: badName });

      const error = await doc.validate().catch((e) => e);

      expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    },
  );

  test("attributes the error to the name field", async () => {
    const doc = new (getModel())({});

    const error = await doc.validate().catch((e) => e);

    expect(error.errors.name).toBeDefined();
    expect(error.errors.name.message).toMatch(/name is required/i);
  });

  test("does not surface a TypeError", async () => {
    const doc = new (getModel())({});

    const error = await doc.validate().catch((e) => e);

    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).not.toMatch(/Cannot read propert/);
  });
});
