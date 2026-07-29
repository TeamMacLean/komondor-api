/**
 * Tests for lib/utils/generateSafeName.js — the slug generator behind every
 * entity's on-disk directory name.
 */

const {
  default: generateSafeName,
  toSafeName,
} = require("../../lib/utils/generateSafeName");

describe("toSafeName", () => {
  test("lowercases", () => {
    expect(toSafeName("MyProject")).toBe("myproject");
  });

  test("replaces spaces and punctuation with underscores", () => {
    expect(toSafeName("my project!")).toBe("my_project_");
  });

  test("replaces every ampersand, not just the first", () => {
    // .replace("&", "and") with a string pattern only replaces one occurrence.
    expect(toSafeName("a & b & c")).toBe("a_and_b_and_c");
  });

  test("keeps digits", () => {
    expect(toSafeName("run2024")).toBe("run2024");
  });

  test("throws for a non-string name", () => {
    expect(() => toSafeName(undefined)).toThrow(TypeError);
    expect(() => toSafeName(null)).toThrow(TypeError);
  });
});

describe("generateSafeName", () => {
  test("returns the plain slug when nothing collides", async () => {
    await expect(generateSafeName("My Project", [])).resolves.toBe("my_project");
  });

  test("appends _2 on the first collision", async () => {
    await expect(
      generateSafeName("My Project", [{ safeName: "my_project" }]),
    ).resolves.toBe("my_project_2");
  });

  test("keeps incrementing past consecutive collisions", async () => {
    await expect(
      generateSafeName("My Project", [
        { safeName: "my_project" },
        { safeName: "my_project_2" },
        { safeName: "my_project_3" },
      ]),
    ).resolves.toBe("my_project_4");
  });

  test("compares case-insensitively", async () => {
    await expect(
      generateSafeName("My Project", [{ safeName: "MY_PROJECT" }]),
    ).resolves.toBe("my_project_2");
  });

  test("ignores unrelated names", async () => {
    await expect(
      generateSafeName("My Project", [{ safeName: "other_thing" }]),
    ).resolves.toBe("my_project");
  });

  test("ignores records with no safeName rather than throwing", async () => {
    await expect(
      generateSafeName("My Project", [{}, { safeName: null }, undefined]),
    ).resolves.toBe("my_project");
  });

  test("tolerates a non-array list", async () => {
    await expect(generateSafeName("My Project", undefined)).resolves.toBe(
      "my_project",
    );
  });

  test("rejects for a non-string name", async () => {
    await expect(generateSafeName(undefined, [])).rejects.toThrow(TypeError);
  });

  test("rejects when the name yields an empty slug", async () => {
    await expect(generateSafeName("", [])).rejects.toThrow(/safe name/);
  });

  test("terminates on a large run of collisions", async () => {
    const list = Array.from({ length: 500 }, (_, i) => ({
      safeName: i === 0 ? "x" : `x_${i + 1}`,
    }));

    await expect(generateSafeName("x", list)).resolves.toBe("x_501");
  });
});
