import { describe, it, expect } from "vitest";
import { scan, scanUnusedCSS } from "../index";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("scan (integration)", () => {
  it("returns results for all 4 categories", () => {
    const results = scan("test-fixtures");
    const types = [...new Set(results.map(r => r.type))];
    expect(types).toContain("duplicate");
    expect(types).toContain("unused");
    expect(types).toContain("redundant");
    expect(types).toContain("architecture");
  });

  it("has valid severity on every result", () => {
    const results = scan("test-fixtures");
    const valid = ["warning", "error", "info"];
    for (const r of results) {
      expect(valid).toContain(r.severity);
    }
  });

  it("has a file path on every result", () => {
    const results = scan("test-fixtures");
    for (const r of results) {
      expect(r.file).toBeTruthy();
    }
  });

  it("finds the expected fixture issues", () => {
    const results = scan("test-fixtures");
    const messages = results.map(r => r.message).join("\n");

    // bad-code.js has: unused imports, duplicate const, duplicate fn, long params
    // redundant-code.js has: long params, deep nesting, duplicate vars
    // styles.css has: duplicate CSS selectors
    // Badge.svelte has: architecture violations
    // package.json has: deprecated packages, malicious packages, unpinned versions, scripts

    expect(messages).toMatch(/notUsed/i);
    expect(messages).toMatch(/declared multiple times/i);
    expect(messages).toMatch(/parameters/i);
    expect(messages).toMatch(/duplicate|multiple times/i);
    expect(messages).toMatch(/\$state|onMount|fetch/);
    expect(messages).toMatch(/deprecated/i);
    expect(messages).toMatch(/potentially malicious|suspiciously similar/i);
    expect(messages).toMatch(/unpinned/i);
  });
});

describe("scanUnusedCSS", () => {
  it("finds unused CSS classes across files", () => {
    const files = [
      { path: "index.html", content: "<div class=\"used\">hi</div>", type: "html" },
    ];
    const cssFiles = [
      { path: "styles.css", content: ".used { color: red; }\n.unused { color: blue; }", type: "css" },
    ];
    const results = scanUnusedCSS(files, cssFiles);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("unused");
  });
});
