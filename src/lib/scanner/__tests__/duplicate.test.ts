import { describe, it, expect } from "vitest";
import { findDuplicateRules } from "../parsers/css-parser";
import { findDuplicateRustFunctions } from "../parsers/rust-parser";

describe("findDuplicateRules (CSS)", () => {
  it("finds duplicate CSS selectors", () => {
    const css = `.btn { color: red; }\n.btn { background: blue; }`;
    const results = findDuplicateRules(css, "test.css");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("duplicate");
    expect(results[0].message).toContain(".btn");
  });

  it("returns empty for unique selectors", () => {
    const css = `.btn { color: red; }\n.card { background: blue; }`;
    const results = findDuplicateRules(css, "test.css");
    expect(results).toHaveLength(0);
  });

  it("finds root-level duplicates only (nested @media rules not yet parsed)", () => {
    const css = `.a { x: 1; }\n.a { y: 2; }`;
    const results = findDuplicateRules(css, "test.css");
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain(".a");
  });

  it("extracts <style> from Svelte files", () => {
    const svelte = `<script>let x=1;</script>\n<style>.a{color:red}</style>\n<div class="a"/>`;
    const results = findDuplicateRules(svelte, "Cmp.svelte");
    expect(results).toHaveLength(0);
  });
});

describe("findDuplicateRustFunctions", () => {
  it("finds same function signature across files", () => {
    const files = [
      { path: "src/a.rs", content: "fn foo(x: i32) -> i32 { x }" },
      { path: "src/b.rs", content: "fn foo(x: i32) -> i32 { x + 1 }" },
    ];
    const results = findDuplicateRustFunctions(files);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("foo");
  });

  it("returns empty for unique functions", () => {
    const files = [
      { path: "src/a.rs", content: "fn foo() {}" },
      { path: "src/b.rs", content: "fn bar() {}" },
    ];
    const results = findDuplicateRustFunctions(files);
    expect(results).toHaveLength(0);
  });

  it("skips build.rs files", () => {
    const files = [
      { path: "build.rs", content: "fn main() {}" },
    ];
    const results = findDuplicateRustFunctions(files);
    expect(results).toHaveLength(0);
  });
});
