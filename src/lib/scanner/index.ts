import { findFiles } from "./file-finder";
import { parseCSS, findDuplicateRules } from "./parsers/css-parser";
import { parseImports, findUnusedImports } from "./parsers/js-parser";
import { parseRustImports, findUnusedRustImports, findDuplicateRustFunctions } from "./parsers/rust-parser";
import { findRedundantCode } from "./detectors/redundant";
import { checkComponentArchitecture, checkFileSize } from "./detectors/component-architecture";
import { checkDependencies } from "./detectors/dependency";
import type { ScanResult, Config, FileContent } from "./types";

export function scan(directory: string, config: Partial<Config> = {}): ScanResult[] {
  const results: ScanResult[] = [];
  const files = findFiles(directory, config.include ? config.include.map(i => i.startsWith(".") ? i : `.${i}`) : undefined);

  const cssFiles = files.filter(f => f.type === "css" || f.type === "svelte");
  const jsFiles = files.filter(f => f.type === "javascript" || f.type === "typescript");
  const rustFiles = files.filter(f => f.type === "rust");
  // Exclude Rust files from redundant check since they're handled by Rust backend
  const otherFiles = files.filter(f => f.type !== "rust");

  // Check for duplicate CSS rules
  if (config.rules?.duplicate !== false) {
    for (const file of cssFiles) {
      const cssResults = findDuplicateRules(file.content, file.path);
      results.push(...cssResults);
    }

    // Check for duplicate Rust functions
    const rustDuplicateResults = findDuplicateRustFunctions(rustFiles);
    results.push(...rustDuplicateResults);
  }

  // Check for unused imports
  if (config.rules?.unused !== false) {
    for (const file of jsFiles) {
      const imports = parseImports(file.content, file.path);
      const unusedResults = findUnusedImports(file.content, imports, file.path);
      results.push(...unusedResults);
    }

    for (const file of rustFiles) {
      const imports = parseRustImports(file.content, file.path);
      const unusedResults = findUnusedRustImports(file.content, imports, file.path);
      results.push(...unusedResults);
    }
  }

  // Check for redundant code patterns (exclude Rust files)
  if (config.rules?.redundant !== false) {
    const redundantResults = findRedundantCode(otherFiles);
    results.push(...redundantResults);
  }

  // Check component architecture (Svelte files)
  const archResults = checkComponentArchitecture(files);
  results.push(...archResults);

  // Check file size / line count thresholds
  const sizeResults = checkFileSize(files);
  results.push(...sizeResults);

  // Check for deprecated and malicious dependencies
  if (config.rules?.dependency !== false) {
    const depResults = checkDependencies(files);
    results.push(...depResults);
  }

  return results;
}

export function scanUnusedCSS(
  files: FileContent[],
  cssFiles: FileContent[]
): ScanResult[] {
  const results: ScanResult[] = [];
  const allClasses = new Map<string, { file: string; line: number; used: boolean }>();

  // Find all CSS classes defined
  for (const cssFile of cssFiles) {
    const classes = parseCSS(cssFile.content, cssFile.path);
    for (const cls of classes) {
      allClasses.set(cls.name, { file: cls.file, line: cls.line, used: false });
    }
  }

  // Find class usages in all files
  for (const file of files) {
    const classMatches = file.content.matchAll(/class=["']([^"']*)["']/g);
    for (const match of classMatches) {
      const classes = match[1].split(/\s+/);
      for (const cls of classes) {
        if (allClasses.has(cls)) {
          allClasses.get(cls)!.used = true;
        }
      }
    }
  }

  // Report unused classes
  for (const [name, info] of allClasses) {
    if (!info.used) {
      results.push({
        file: info.file,
        type: "unused",
        severity: "warning",
        message: `CSS class ".${name}" is defined but never used`,
        line: info.line
      });
    }
  }

  return results;
}