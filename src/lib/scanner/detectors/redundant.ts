import type { ScanResult, FileContent } from "../types";

export function findRedundantCode(files: FileContent[]): ScanResult[] {
  const results: ScanResult[] = [];

  for (const file of files) {
    const content = file.content;
    const filePath = file.path;
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      const indentLevel = line.match(/^(\s*)/)?.[1].length || 0;
      if (indentLevel > 32) {
        results.push({
          file: filePath,
          type: "redundant",
          severity: "warning",
          message: "Code has deeply nested structure (16+ levels at 2-space indent)",
          line: i + 1,
          codeSnippet: trimmed.substring(0, 80)
        });
      }

      // Overly long parameter list
      if (/^\s*(?:fn|function|const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\))/.test(line) || /^\s*(?:export\s+)?(?:async\s+)?function\s+\w*\s*\(/.test(line) || /^\s*fn\s+\w+\s*\(/.test(line)) {
        const paramMatch = line.match(/\(([^)]*)\)/);
        if (paramMatch) {
          const params = paramMatch[1].split(",").filter(p => p.trim().length > 0);
          if (params.length > 8) {
            results.push({
              file: filePath,
              type: "redundant",
              severity: "info",
              message: `Function has ${params.length} parameters, consider refactoring`,
              line: i + 1,
              codeSnippet: trimmed.substring(0, 80)
            });
          }
        }
      }

      // Duplicate variable declarations (same name on consecutive lines)
      if (i + 1 < lines.length) {
        const varDeclRegex = /^\s*(?:const|let|var)\s+(\w+)\s*(?:=|;|$)/;
        const thisMatch = trimmed.match(varDeclRegex);
        const nextMatch = lines[i + 1].trim().match(varDeclRegex);
        if (thisMatch && nextMatch && thisMatch[1] === nextMatch[1]) {
          results.push({
            file: filePath,
            type: "redundant",
            severity: "info",
            message: `Variable "${thisMatch[1]}" is declared multiple times`,
            line: i + 1,
            codeSnippet: `${trimmed} / ${lines[i + 1].trim()}`
          });
        }
      }
    }
  }

  return results;
}
