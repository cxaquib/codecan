import { describe, it, expect } from "vitest";
import { checkDependencies } from "../detectors/dependency";
import type { FileContent } from "../types";

describe("checkDependencies", () => {
  it("detects deprecated npm packages", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { request: "^2.88.0", "left-pad": "1.0.0" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const deprecated = results.filter(r => r.message.startsWith("Deprecated"));
    expect(deprecated.length).toBeGreaterThanOrEqual(2);
    expect(deprecated.some(r => r.message.includes("request"))).toBe(true);
    expect(deprecated.some(r => r.message.includes("left-pad"))).toBe(true);
  });

  it("flags malicious/typosquatting packages", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { crossenv: "1.0.0", lodahs: "1.0.0" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const malicious = results.filter(r => r.message.startsWith("Potentially malicious") || r.message.includes("suspiciously similar"));
    expect(malicious.length).toBeGreaterThanOrEqual(1);
  });

  it("flags unpinned version ranges", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { express: "^4.18.0", lodash: "~4.17.0" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const unpinned = results.filter(r => r.message.includes("unpinned"));
    expect(unpinned).toHaveLength(2);
  });

  it("does not flag pinned versions", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "18.2.0" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const unpinned = results.filter(r => r.message.includes("unpinned"));
    expect(unpinned).toHaveLength(0);
  });

  it("flags suspicious install scripts", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "18.2.0" },
          scripts: { postinstall: "node setup.js", preinstall: "echo hi" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const scriptIssues = results.filter(r => r.message.includes("script hook"));
    expect(scriptIssues).toHaveLength(2);
  });

  it("reports invalid JSON", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: "{ invalid json here }",
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("error");
    expect(results[0].message).toContain("valid JSON");
  });

  it("checks devDependencies and peerDependencies", () => {
    const files: FileContent[] = [
      {
        path: "package.json",
        content: JSON.stringify({
          devDependencies: { "node-uuid": "1.4.8" },
          peerDependencies: { jade: "1.11.0" },
        }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    const deprecated = results.filter(r => r.message.startsWith("Deprecated"));
    expect(deprecated).toHaveLength(2);
  });

  it("checks Cargo.toml for deprecated crates and wildcard versions", () => {
    const files: FileContent[] = [
      {
        path: "Cargo.toml",
        content: "[dependencies]\nrustc-serialize = \"0.3\"\nserde = \"*\"\n",
        type: "toml",
      },
    ];
    const results = checkDependencies(files);
    expect(results).toHaveLength(2);
    expect(results.some(r => r.message.includes("rustc-serialize"))).toBe(true);
    expect(results.some(r => r.message.includes("wildcard"))).toBe(true);
  });

  it("skips non-dependency files", () => {
    const files: FileContent[] = [
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: {} }),
        type: "json",
      },
    ];
    const results = checkDependencies(files);
    expect(results).toHaveLength(0);
  });

  it("scans all dependency files from test-fixtures", () => {
    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const pkg = readFileSync(resolve("test-fixtures/package.json"), "utf-8");
    const files: FileContent[] = [
      { path: "test-fixtures/package.json", content: pkg, type: "json" },
    ];
    const results = checkDependencies(files);
    // Expect at least: request (deprecated), left-pad (deprecated), moment (deprecated),
    // faker (deprecated), crossenv (malicious), lodahs (typosquat),
    // ^2.88.2 and ~5.6.2 (unpinned), postinstall (script hook)
    expect(results.length).toBeGreaterThanOrEqual(8);
  });
});
