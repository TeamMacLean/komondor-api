/**
 * Tests for routes/options.js
 *
 * Covers the shared GET/POST/DELETE behaviour of the option collections, the
 * authentication gate on writes, and the guard against deleting an arbitrary
 * document when no id is supplied.
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

/**
 * Builds a mock mongoose model whose constructor records the document it was
 * given and whose save() is controllable per test.
 */
const makeModelMock = () => {
  const saveMock = jest.fn().mockResolvedValue({ _id: "saved" });
  const ctor = jest.fn(function (doc) {
    ctor.lastDoc = doc;
    this.save = saveMock;
  });
  ctor.saveMock = saveMock;
  ctor.find = jest.fn(() => ({ sort: jest.fn().mockResolvedValue([]) }));
  ctor.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
  return ctor;
};

const mockModels = {
  LibrarySelection: makeModelMock(),
  LibrarySource: makeModelMock(),
  LibraryStrategy: makeModelMock(),
  LibraryType: makeModelMock(),
  SequencingTechnology: makeModelMock(),
};

jest.mock(
  "../../models/options/LibrarySelection",
  () => mockModels.LibrarySelection,
);
jest.mock("../../models/options/LibrarySource", () => mockModels.LibrarySource);
jest.mock(
  "../../models/options/LibraryStrategy",
  () => mockModels.LibraryStrategy,
);
jest.mock("../../models/options/LibraryType", () => mockModels.LibraryType);
jest.mock(
  "../../models/options/SequencingTechnology",
  () => mockModels.SequencingTechnology,
);

let mockAuthenticatedUser = { username: "testuser", groups: [] };

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    if (!mockAuthenticatedUser) {
      return res.status(401).send({ error: "Authentication required" });
    }
    req.user = mockAuthenticatedUser;
    next();
  },
  isAdmin: (req, res, next) => next(),
}));

const optionsRouter = require("../../routes/options");

const app = express();
app.use(express.json());
app.use("/", optionsRouter);

const OPTION_PATHS = [
  ["/options/libraryselection", "LibrarySelection"],
  ["/options/librarysource", "LibrarySource"],
  ["/options/librarystrategy", "LibraryStrategy"],
  ["/options/librarytype", "LibraryType"],
  ["/options/sequencingtechnology", "SequencingTechnology"],
];

const ORIGINAL_FLAG = process.env.OPTIONS_WRITE_REQUIRE_AUTH;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticatedUser = { username: "testuser", groups: [] };
  delete process.env.OPTIONS_WRITE_REQUIRE_AUTH;
  Object.values(mockModels).forEach((model) => {
    model.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    model.deleteOne.mockResolvedValue({ deletedCount: 1 });
    model.saveMock.mockResolvedValue({ _id: "saved" });
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.OPTIONS_WRITE_REQUIRE_AUTH;
  } else {
    process.env.OPTIONS_WRITE_REQUIRE_AUTH = ORIGINAL_FLAG;
  }
});

describe.each(OPTION_PATHS)("%s", (path, modelName) => {
  const model = () => mockModels[modelName];

  describe("GET", () => {
    test("returns the options sorted by value", async () => {
      const sort = jest.fn().mockResolvedValue([{ value: "a" }]);
      model().find.mockReturnValue({ sort });

      const response = await request(app).get(path);

      expect(response.status).toBe(200);
      expect(response.body.options).toEqual([{ value: "a" }]);
      expect(sort).toHaveBeenCalledWith({ value: 1 });
    });

    test("remains readable without authentication", async () => {
      mockAuthenticatedUser = null;

      const response = await request(app).get(path);

      expect(response.status).toBe(200);
    });

    test("answers 500 when the lookup fails", async () => {
      model().find.mockReturnValue({
        sort: jest.fn().mockRejectedValue(new Error("db down")),
      });

      const response = await request(app).get(path);

      expect(response.status).toBe(500);
    });
  });

  describe("POST", () => {
    test("creates an option", async () => {
      const response = await request(app).post(path).send({ value: "new" });

      expect(response.status).toBe(200);
      expect(response.body.doc).toEqual({ _id: "saved" });
      expect(model().lastDoc).toEqual(expect.objectContaining({ value: "new" }));
    });

    test("rejects a missing value", async () => {
      const response = await request(app).post(path).send({});

      expect(response.status).toBe(400);
      expect(model().saveMock).not.toHaveBeenCalled();
    });

    test("rejects a blank value", async () => {
      const response = await request(app).post(path).send({ value: "   " });

      expect(response.status).toBe(400);
    });

    test("rejects a non-string value", async () => {
      const response = await request(app).post(path).send({ value: { a: 1 } });

      expect(response.status).toBe(400);
    });

    test("requires authentication by default", async () => {
      mockAuthenticatedUser = null;

      const response = await request(app).post(path).send({ value: "new" });

      expect(response.status).toBe(401);
      expect(model().saveMock).not.toHaveBeenCalled();
    });

    test("allows unauthenticated writes when the opt-out flag is set", async () => {
      process.env.OPTIONS_WRITE_REQUIRE_AUTH = "false";
      mockAuthenticatedUser = null;

      const response = await request(app).post(path).send({ value: "new" });

      expect(response.status).toBe(200);
    });

    test("maps a validation error to 400", async () => {
      const validationError = new Error("bad");
      validationError.name = "ValidationError";
      model().saveMock.mockRejectedValue(validationError);

      const response = await request(app).post(path).send({ value: "new" });

      expect(response.status).toBe(400);
    });

    test("maps an unexpected error to 500", async () => {
      model().saveMock.mockRejectedValue(new Error("db down"));

      const response = await request(app).post(path).send({ value: "new" });

      expect(response.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    const validId = new mongoose.Types.ObjectId().toString();

    test("deletes by id", async () => {
      const response = await request(app).delete(path).send({ id: validId });

      expect(response.status).toBe(200);
      expect(model().deleteOne).toHaveBeenCalledWith({ _id: validId });
    });

    test("rejects a missing id without touching the collection", async () => {
      // Mongoose strips undefined from a filter, so deleteOne({ _id: undefined })
      // becomes deleteOne({}) and removes an arbitrary document.
      const response = await request(app).delete(path).send({});

      expect(response.status).toBe(400);
      expect(model().deleteOne).not.toHaveBeenCalled();
    });

    test("rejects a null id without touching the collection", async () => {
      const response = await request(app).delete(path).send({ id: null });

      expect(response.status).toBe(400);
      expect(model().deleteOne).not.toHaveBeenCalled();
    });

    test("rejects a malformed id without touching the collection", async () => {
      const response = await request(app).delete(path).send({ id: "not-an-id" });

      expect(response.status).toBe(400);
      expect(model().deleteOne).not.toHaveBeenCalled();
    });

    test("returns 404 when nothing was deleted", async () => {
      model().deleteOne.mockResolvedValue({ deletedCount: 0 });

      const response = await request(app).delete(path).send({ id: validId });

      expect(response.status).toBe(404);
    });

    test("requires authentication by default", async () => {
      mockAuthenticatedUser = null;

      const response = await request(app).delete(path).send({ id: validId });

      expect(response.status).toBe(401);
      expect(model().deleteOne).not.toHaveBeenCalled();
    });

    test("answers 500 when the delete fails", async () => {
      model().deleteOne.mockRejectedValue(new Error("db down"));

      const response = await request(app).delete(path).send({ id: validId });

      expect(response.status).toBe(500);
    });
  });
});

describe("/options/librarytype specifics", () => {
  test("persists the paired flag and extensions", async () => {
    await request(app)
      .post("/options/librarytype")
      .send({ value: "paired-end", paired: true, extensions: [".fq"] });

    expect(mockModels.LibraryType.lastDoc).toEqual({
      value: "paired-end",
      paired: true,
      extensions: [".fq"],
    });
  });

  test("defaults paired and extensions when omitted", async () => {
    await request(app).post("/options/librarytype").send({ value: "single" });

    expect(mockModels.LibraryType.lastDoc).toEqual({
      value: "single",
      paired: false,
      extensions: [],
    });
  });
});
