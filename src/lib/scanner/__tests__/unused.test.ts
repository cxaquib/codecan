import { describe, it, expect } from "vitest";
import { parseImports, findUnusedImports } from "../parsers/js-parser";
import { parseRustImports, findUnusedRustImports } from "../parsers/rust-parser";

describe("parseImports (JS/TS)", () => {
  it("parses named imports", () => {
    const code = `import { foo, bar } from "./utils";`;
    const imports = parseImports(code, "test.ts");
    expect(imports).toHaveLength(1);
    expect(imports[0].importedNames).toEqual(["foo", "bar"]);
    expect(imports[0].source).toBe("./utils");
  });

  it("parses default imports", () => {
    const code = `import React from "react";`;
    const imports = parseImports(code, "test.tsx");
    expect(imports).toHaveLength(1);
    expect(imports[0].importedNames).toEqual(["React"]);
  });

  it("parses namespace imports", () => {
    const code = `import * as utils from "./utils";`;
    const imports = parseImports(code, "test.ts");
    expect(imports).toHaveLength(1);
    expect(imports[0].importedNames).toEqual(["utils"]);
  });
});

describe("findUnusedImports (JS/TS)", () => {
  it("flags unused named imports", () => {
    const code = `import { readFile } from "fs";\nconst x = 1;`;
    const imports = parseImports(code, "test.ts");
    const results = findUnusedImports(code, imports, "test.ts");
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("readFile");
  });

  it("does not flag used imports", () => {
    const code = `import { readFile } from "fs";\nconst data = readFile("x");`;
    const imports = parseImports(code, "test.ts");
    const results = findUnusedImports(code, imports, "test.ts");
    expect(results).toHaveLength(0);
  });

  it("handles multiple unused imports", () => {
    const code = `import { a, b, c } from "mod";\nconsole.log("hi");`;
    const imports = parseImports(code, "test.ts");
    const results = findUnusedImports(code, imports, "test.ts");
    expect(results).toHaveLength(3);
  });

  it("does not flag import lines themselves as usage", () => {
    const code = `import { readFile } from "fs";\nimport { writeFile } from "fs";\nreadFile("x");`;
    const imports = parseImports(code, "test.ts");
    const results = findUnusedImports(code, imports, "test.ts");
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("writeFile");
  });
});

describe("parseRustImports", () => {
  it("parses use statements", () => {
    const code = `use std::fs;\nuse crate::utils::helper;`;
    const imports = parseRustImports(code, "test.rs");
    expect(imports).toHaveLength(2);
    expect(imports[0]).toBe("std::fs");
    expect(imports[1]).toBe("crate::utils::helper");
  });

  it("skips non-import lines", () => {
    const code = `fn main() {\n  let x = 1;\n}`;
    const imports = parseRustImports(code, "test.rs");
    expect(imports).toHaveLength(0);
  });
});

describe("findUnusedRustImports", () => {
  it("flags unused imports", () => {
    const code = `use std::fs;\nfn main() {}`;
    const imports = parseRustImports(code, "test.rs");
    const results = findUnusedRustImports(code, imports, "test.rs");
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("std::fs");
  });

  it("does not flag used imports", () => {
    const code = `use std::fs;\nfn main() { fs::read_to_string(\"x\"); }`;
    const imports = parseRustImports(code, "test.rs");
    const results = findUnusedRustImports(code, imports, "test.rs");
    expect(results).toHaveLength(0);
  });
});
