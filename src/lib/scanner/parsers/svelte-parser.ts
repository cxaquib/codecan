import type { ScanResult, CSSClassInfo } from "../types";
import { createHash } from "crypto";

export function parseSvelte(content: string, filePath: string): {
  scriptImports: string[];
  cssClasses: CSSClassInfo[];
  inlineStyles: string[];
} {
  const scriptImports: string[] = [];
  const cssClasses: CSSClassInfo[] = [];
  const inlineStyles: string[] = [];

  // Extract script section
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1];
    const importMatches = scriptContent.matchAll(/import\s+\{([^}]+)\}\s+from/g);
    for (const match of importMatches) {
      scriptImports.push(match[1]);
    }
  }

  // Extract style section
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    const cssContent = styleMatch[1];
    const lines = cssContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
      if (classMatch) {
        for (const m of classMatch) {
          cssClasses.push({
            name: m.substring(1),
            file: filePath,
            line: i + 1,
            usedIn: []
          });
        }
      }
    }
  }

  // Extract class in HTML/template
  const classMatches = content.matchAll(/class=["\']([^"\']*)["\']/g);
  for (const match of classMatches) {
    const classes = match[1].split(/\s+/);
    inlineStyles.push(...classes);
  }

  return { scriptImports, cssClasses, inlineStyles };
}

export function findDuplicateStyleBlocks(
  contents: Array<{ path: string; content: string }>
): ScanResult[] {
  const results: ScanResult[] = [];
  const styleBlockMap = new Map<string, Array<{ path: string; content: string }>>();

  for (const { path, content } of contents) {
    // Extract style blocks
    const styleMatches = content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g);
    for (const match of styleMatches) {
      const normalizedStyle = normalizeCSS(match[1]);
      const hash = createHash("md5").update(normalizedStyle).digest("hex");

      if (!styleBlockMap.has(hash)) {
        styleBlockMap.set(hash, []);
      }
      styleBlockMap.get(hash)!.push({ path, content: match[1] });
    }
  }

  // Report duplicates
  for (const [, entries] of styleBlockMap) {
    if (entries.length > 1) {
      results.push({
        file: entries[0].path,
        type: "duplicate",
        severity: "warning",
        message: `Duplicate style block found in ${entries.length} files`,
        codeSnippet: entries[0].content.substring(0, 100) + "..."
      });
    }
  }

  return results;
}

function normalizeCSS(css: string): string {
  return css
    .replace(/\s+/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
}