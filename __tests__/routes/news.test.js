/**
 * Tests for routes/news.js
 */

const request = require("supertest");
const express = require("express");

jest.mock("../../models/NewsItem", () => ({ iCanSee: jest.fn() }));

jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    req.user = { username: "testuser", groups: ["g1"] };
    next();
  },
  isAdmin: (req, res, next) => next(),
}));

const NewsItem = require("../../models/NewsItem");
const newsRouter = require("../../routes/news");
const { formatDateCalendar } = require("../../routes/news");

const app = express();
app.use(express.json());
app.use("/", newsRouter);

/** Stubs the sort().limit() chain that the route uses. */
const makeChain = (result) => {
  const limit = jest.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const sort = jest.fn(() => ({ limit }));
  return { sort, limit };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /news", () => {
  test("returns mapped news items", async () => {
    const createdAt = new Date();
    NewsItem.iCanSee.mockReturnValue(
      makeChain([
        {
          type: "project",
          owner: "alice",
          name: "My Project",
          body: "a description",
          createdAt,
          typeId: "abc123",
        },
      ]),
    );

    const response = await request(app).get("/news");

    expect(response.status).toBe(200);
    expect(response.body.news).toHaveLength(1);
    expect(response.body.news[0]).toEqual(
      expect.objectContaining({
        type: "project",
        user: "alice",
        name: "My Project",
        body: "a description",
        link: { name: "project", query: { id: "abc123" } },
      }),
    );
  });

  test("scopes the query to the requesting user", async () => {
    NewsItem.iCanSee.mockReturnValue(makeChain([]));

    await request(app).get("/news");

    expect(NewsItem.iCanSee).toHaveBeenCalledWith(
      expect.objectContaining({ username: "testuser" }),
    );
  });

  test("sorts newest first and caps the result count", async () => {
    const chain = makeChain([]);
    NewsItem.iCanSee.mockReturnValue(chain);

    await request(app).get("/news");

    expect(chain.sort).toHaveBeenCalledWith("-createdAt");
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  test("returns an empty list when there is no news", async () => {
    NewsItem.iCanSee.mockReturnValue(makeChain([]));

    const response = await request(app).get("/news");

    expect(response.status).toBe(200);
    expect(response.body.news).toEqual([]);
  });

  test("answers 500 with a readable message when the query fails", async () => {
    // The previous handler sent `new Error(...)` as the body, which serialises
    // to {} and told the client nothing.
    NewsItem.iCanSee.mockReturnValue(makeChain(new Error("db down")));

    const response = await request(app).get("/news");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("could not get news");
    expect(response.body.detail).toBe("db down");
  });

  test("sends exactly one response", async () => {
    // A stray res.status(500) used to run after the async chain was started.
    NewsItem.iCanSee.mockReturnValue(makeChain([]));

    const response = await request(app).get("/news");

    expect(response.status).toBe(200);
  });
});

describe("formatDateCalendar", () => {
  // These compare "now" against a date derived from Date.now(), and the
  // function captures its own `new Date()` a moment later. Freezing the clock
  // removes that gap, so a slow run or an NTP step cannot change the label.
  // Wednesday midday, so "three days ago" still lands inside the week.
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-17T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("labels today", () => {
    expect(formatDateCalendar(new Date())).toMatch(/^Today at /);
  });

  test("labels a date in the future as today", () => {
    // Clock skew between hosts previously floored to -1 and rendered these as
    // "Last <weekday>".
    const skewed = new Date(Date.now() + 30 * 1000);
    expect(formatDateCalendar(skewed)).toMatch(/^Today at /);
  });

  test("labels yesterday", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatDateCalendar(yesterday)).toMatch(/^Yesterday at /);
  });

  test("labels earlier this week by weekday", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatDateCalendar(threeDaysAgo)).toMatch(/^Last \w+ at /);
  });

  test("falls back to an absolute date beyond a week", () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(formatDateCalendar(longAgo)).toMatch(/\d{4} at /);
  });

  test("handles an unparseable date without throwing", () => {
    expect(formatDateCalendar("not a date")).toBe("Unknown date");
  });

  test("handles undefined without throwing", () => {
    expect(formatDateCalendar(undefined)).toBe("Unknown date");
  });
});
