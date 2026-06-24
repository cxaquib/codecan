import type { ImportInfo, ScanResult } from "../types";

export function parseImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match ES6 imports: import { a, b } from "module"
    const namedImportMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/);
    if (namedImportMatch) {
      const names = namedImportMatch[1].split(",").map(n => n.trim()).filter(Boolean);
      imports.push({
        source: namedImportMatch[2],
        importedNames: names,
        file: filePath,
        line: i + 1,
        used: false
      });
    }

    // Match default imports: import name from "module"
    const defaultImportMatch = line.match(/import\s+(\w+)\s+from\s*["']([^"']+)["']/);
    if (defaultImportMatch && !namedImportMatch) {
      imports.push({
        source: defaultImportMatch[2],
        importedNames: [defaultImportMatch[1]],
        file: filePath,
        line: i + 1,
        used: false
      });
    }

    // Match namespace imports: import * as name from "module"
    const namespaceImportMatch = line.match(/import\s*\*\s*as\s+(\w+)\s+from\s*["']([^"']+)["']/);
    if (namespaceImportMatch) {
      imports.push({
        source: namespaceImportMatch[2],
        importedNames: [namespaceImportMatch[1]],
        file: filePath,
        line: i + 1,
        used: false
      });
    }
  }

  return imports;
}

export function findUnusedImports(
  content: string,
  imports: ImportInfo[],
  filePath: string
): ScanResult[] {
  const results: ScanResult[] = [];
  const lines = content.split("\n");

  // Get all identifiers used in the file, excluding import lines
  const usedIdentifiers = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import lines so the import declaration itself doesn't count as usage
    if (line.trim().startsWith("import ")) continue;
    const identifiers = line.matchAll(/\b(\w+)\b/g);
    for (const match of identifiers) {
      usedIdentifiers.add(match[1]);
    }
  }

  // Check each imported name
  for (const imp of imports) {
    for (const name of imp.importedNames) {
      if (!usedIdentifiers.has(name)) {
        results.push({
          file: filePath,
          type: "unused",
          severity: "warning",
          message: `Imported "${name}" from "${imp.source}" is never used`,
          line: imp.line,
          codeSnippet: lines[imp.line - 1]
        });
      }
    }
  }

  return results;
}