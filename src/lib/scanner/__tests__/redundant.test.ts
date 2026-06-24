import { describe, it, expect } from "vitest";
import { findRedundantCode } from "../detectors/redundant";
import type { FileContent } from "../types";

function makeFile(content: string, path = "test.js"): FileContent[] {
  return [{ path, content, type: "javascript" }];
}

describe("findRedundantCode", () => {
  it("flags deeply nested code (>32 spaces indent)", () => {
    const code = `function outer() {\n${"  ".repeat(17)}const x = 1;\n}`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("redundant");
    expect(results[0].message).toContain("deeply nested");
  });

  it("ignores normal indentation", () => {
    const code = `function outer() {\n  const x = 1;\n}`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(0);
  });

  it("flags long parameter lists (>8 params)", () => {
    const code = `function process(a, b, c, d, e, f, g, h, i) {}`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("parameters");
  });

  it("ignores short parameter lists", () => {
    const code = `function add(a, b) {}`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(0);
  });

  it("flags duplicate variable declarations on consecutive lines", () => {
    const code = `const x = 1;\nconst x = 2;`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("declared multiple times");
  });

  it("ignores unique variable declarations", () => {
    const code = `const x = 1;\nconst y = 2;`;
    const results = findRedundantCode(makeFile(code));
    expect(results).toHaveLength(0);
  });

  it("flags deep nesting, long params, and duplicate vars in one file", () => {
    const code = `function process(a, b, c, d, e, f, g, h, i) {\n${"  ".repeat(17)}const x = 1;\n}\nconst y = 1;\nconst y = 2;`;
    const results = findRedundantCode(makeFile(code));
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});
