import { describe, it, expect } from "vitest";
import { checkComponentArchitecture, checkFileSize } from "../detectors/component-architecture";
import type { FileContent } from "../types";

describe("checkComponentArchitecture", () => {
  it("flags presentational components with $state", () => {
    const files: FileContent[] = [
      {
        path: "src/lib/components/Button.svelte",
        content: "<script lang=\"ts\">\n  let count = $state(0);\n</script>\n<button>{count}</button>",
        type: "svelte",
      },
    ];
    const results = checkComponentArchitecture(files);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("architecture");
    expect(results[0].message).toContain("$state");
  });

  it("flags presentational components with onMount", () => {
    const files: FileContent[] = [
      {
        path: "src/lib/ui/Card.svelte",
        content: "<script lang=\"ts\">\n  import { onMount } from \"svelte\";\n  onMount(() => {});\n</script>\n<div>card</div>",
        type: "svelte",
      },
    ];
    const results = checkComponentArchitecture(files);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("onMount");
  });

  it("flags presentational components with fetch", () => {
    const files: FileContent[] = [
      {
        path: "src/lib/components/Badge.svelte",
        content: "<script>\n  fetch(\"/api/data\");\n</script>\n<span>badge</span>",
        type: "svelte",
      },
    ];
    const results = checkComponentArchitecture(files);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("fetch");
  });

  it("does not flag non-dumb components", () => {
    const files: FileContent[] = [
      {
        path: "src/lib/stores/counter.svelte",
        content: "<script>\n  let count = $state(0);\n</script>\n{count}",
        type: "svelte",
      },
    ];
    const results = checkComponentArchitecture(files);
    const stateResults = results.filter(r => r.message.includes("$state"));
    expect(stateResults).toHaveLength(0);
  });

  it("does not flag route pages", () => {
    const files: FileContent[] = [
      {
        path: "src/routes/+page.svelte",
        content: "<script>\n  let data = $state([]);\n</script>\n{data}",
        type: "svelte",
      },
    ];
    const results = checkComponentArchitecture(files);
    const stateResults = results.filter(r => r.message.includes("$state"));
    expect(stateResults).toHaveLength(0);
  });
});

describe("checkFileSize", () => {
  it("flags svelte files with >200 lines", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `// line ${i + 1}`);
    const files: FileContent[] = [
      { path: "src/lib/Large.svelte", content: lines.join("\n"), type: "svelte" },
    ];
    const results = checkFileSize(files);
    const lineResults = results.filter(r => r.message.includes("lines"));
    expect(lineResults).toHaveLength(1);
  });

  it("flags TS/JS files with >300 lines", () => {
    const lines = Array.from({ length: 350 }, (_, i) => `// line ${i + 1}`);
    const files: FileContent[] = [
      { path: "src/lib/large.ts", content: lines.join("\n"), type: "typescript" },
    ];
    const results = checkFileSize(files);
    const lineResults = results.filter(r => r.message.includes("lines"));
    expect(lineResults).toHaveLength(1);
  });

  it("does not flag small files", () => {
    const files: FileContent[] = [
      { path: "src/lib/small.ts", content: "const x = 1;\n", type: "typescript" },
    ];
    const results = checkFileSize(files);
    expect(results).toHaveLength(0);
  });

  it("flags unusually large files by byte size", () => {
    const content = "x".repeat(60 * 1024);
    const files: FileContent[] = [
      { path: "src/lib/huge.ts", content, type: "typescript" },
    ];
    const results = checkFileSize(files);
    const sizeResults = results.filter(r => r.message.includes("KB"));
    expect(sizeResults).toHaveLength(1);
  });
});

