import type { ScanResult } from "../types";

export function parseRustImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match use statements: use crate::module::item;
    const trimmed = line.trim();
    if (!trimmed.startsWith("use ")) continue;
    const useMatch = line.match(/^[\s]*use\s+([^;]+);/);
    if (useMatch) {
      imports.push(useMatch[1].trim());
    }
  }

  return imports;
}

export function findUnusedRustImports(
  content: string,
  imports: string[],
  filePath: string
): ScanResult[] {
  const results: ScanResult[] = [];
  const lines = content.split("\n");

  // Build a set of used identifiers, excluding use lines
  const usedIdentifiers = new Set<string>();

  for (const line of lines) {
    if (line.trim().startsWith("use ")) continue;
    const matches = line.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g);
    for (const match of matches) {
      usedIdentifiers.add(match[1]);
    }
  }

  // Check each import
  for (const imp of imports) {
    // Extract the last segment (the actual item name)
    const segments = imp.split("::");
    const itemName = segments[segments.length - 1];

    if (!usedIdentifiers.has(itemName)) {
      // Find line number
      const lineIndex = lines.findIndex(l => l.includes(imp));
      results.push({
        file: filePath,
        type: "unused",
        severity: "warning",
        message: `Imported "${imp}" appears to be unused`,
        line: lineIndex + 1
      });
    }
  }

  return results;
}

export function findDuplicateRustFunctions(
  contents: Array<{ path: string; content: string }>
): ScanResult[] {
  const results: ScanResult[] = [];
  const functionMap = new Map<string, Array<{ path: string; line: number; name: string }>>();

  for (const { path, content } of contents) {
    // Skip build.rs which is a build script with different structure
    if (path.endsWith("build.rs")) continue;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match function signatures (including pub fn)
      const funcMatch = line.match(/fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
      if (funcMatch) {
        const name = funcMatch[1];
        const params = funcMatch[2];

        // Normalize for comparison
        const key = `${name}(${params})`.replace(/\s+/g, "");

        if (!functionMap.has(key)) {
          functionMap.set(key, []);
        }
        functionMap.get(key)!.push({ path, line: i + 1, name });
      }
    }
  }

  // Report duplicates - only if same function name appears in multiple files
  for (const [key, entries] of functionMap) {
    const uniqueFiles = [...new Set(entries.map(e => e.path))];
    if (uniqueFiles.length > 1 || (uniqueFiles.length === 1 && entries.length > 1)) {
      const displayFiles = [...new Set(entries.map(e => e.path))];
      results.push({
        file: entries[0].path,
        type: "duplicate",
        severity: "info",
        message: `Function "${entries[0].name}" appears in ${entries.length} places${displayFiles.length > 1 ? ` across files: ${displayFiles.join(", ")}` : ""}`
      });
    }
  }

  return results;
}