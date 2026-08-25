/**
 * Regression test for the query middleware on models/Project.js.
 *
 * The schema used to carry:
 *
 *   schema.pre("updateOne", (next) => { const data = this.getUpdate(); next(); });
 *   schema.post("update",   (next) => { const data = this.getUpdate(); next(); });
 *
 * Both were arrow functions, so `this` was the module's exports object rather
 * than the query, and `this.getUpdate` was undefined. Any call to
 * Project.updateOne() therefore threw `TypeError: this.getUpdate is not a
 * function` out of the pre-hook chain, before the query reached the database.
 * Neither hook used the value it fetched, so both were deleted.
 *
 * routes/projects.js avoided Project.updateOne() entirely because of this, so
 * the crash never surfaced in production — which is exactly why it needs a test
 * rather than a comment. Note that a `pre("updateOne")` hook IS still
 * registered: mongoose adds its own for `{ timestamps: true }`. Asserting on
 * the presence of the hook name would therefore prove nothing, so these tests
 * run the middleware chain instead.
 */

const mongoose = require("mongoose");

// The pre-hooks run before any connection is used. Turning off buffering makes
// exec() settle immediately instead of waiting out the buffer timeout.
mongoose.set("bufferCommands", false);

const Project = require("../../models/Project");

afterAll(async () => {
  await mongoose.connection.close();
});

describe("Project query middleware", () => {
  test("Project.updateOne() builds a query instead of throwing", () => {
    expect(() =>
      Project.updateOne({ _id: "abc" }, { $set: { nudgeable: true } }),
    ).not.toThrow();
  });

  test("the updateOne pre-hook chain runs without a TypeError", async () => {
    // A deliberately un-castable id: reaching a CastError proves the hook
    // chain completed. With the arrow-function hook in place this rejected
    // with "this.getUpdate is not a function" and never got that far.
    expect.assertions(2);

    try {
      await Project.updateOne(
        { _id: "abc" },
        { $set: { nudgeable: true } },
      ).exec();
    } catch (error) {
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error.name).toBe("CastError");
    }
  });

  test("registers no post-update hook", () => {
    const posts = Project.schema.s.hooks._posts;
    expect([...(posts ? posts.keys() : [])]).not.toContain("update");
  });
});
