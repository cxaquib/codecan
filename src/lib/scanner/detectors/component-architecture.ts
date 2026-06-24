import type { ScanResult, FileContent } from "../types";
import { statSync } from "fs";

const DUMB_COMPONENT_PATTERNS = [
  /\/components\//,
  /\/ui\//,
  /\/atoms\//,
];

const DUMB_COMPONENT_NAMES = [
  "button", "card", "input", "modal", "badge", "icon", "avatar", "tag", "chip",
  "dropdown", "tooltip", "popover", "accordion", "tabs", "breadcrumb", "pagination",
  "spinner", "skeleton", "alert", "toast", "drawer", "label", "select", "checkbox",
  "radio", "switch", "slider", "progress", "divider", "list", "table", "menu",
  "navbar", "footer", "heading", "text", "link", "image", "video", "collapse",
  "carousel", "rating", "timeline", "fileupload", "search", "sidebar", "overlay",
];

const SMART_INDICATORS = [
  { regex: /\$state\s*\(/, msg: "uses $state (state management)", severity: "warning" },
  { regex: /\$derived\s*\(/, msg: "uses $derived (derived state)", severity: "info" },
  { regex: /\$effect\s*\(/, msg: "uses $effect (side effects)", severity: "info" },
  { regex: /onMount\s*\(/, msg: "uses onMount lifecycle hook", severity: "info" },
  { regex: /onDestroy\s*\(/, msg: "uses onDestroy lifecycle hook", severity: "info" },
  { regex: /invoke\s*\(/, msg: "calls invoke (data fetching)", severity: "warning" },
  { regex: /fetch\s*\(/, msg: "uses fetch (data fetching)", severity: "warning" },
  { regex: /writable\s*\(/, msg: "creates a writable store", severity: "warning" },
  { regex: /readable\s*\(/, msg: "creates a readable store", severity: "warning" },
];

const LINE_THRESHOLDS: Record<string, { warn: number; error: number }> = {
  ".svelte": { warn: 200, error: 400 },
  ".ts": { warn: 300, error: 600 },
  ".js": { warn: 300, error: 600 },
  ".rs": { warn: 300, error: 600 },
  ".css": { warn: 400, error: 800 },
};

const SIZE_THRESHOLDS: Record<string, { warn: number; error: number }> = {
  ".svelte": { warn: 10 * 1024, error: 30 * 1024 },
  ".ts": { warn: 20 * 1024, error: 50 * 1024 },
  ".js": { warn: 20 * 1024, error: 50 * 1024 },
  ".rs": { warn: 20 * 1024, error: 50 * 1024 },
  ".css": { warn: 30 * 1024, error: 60 * 1024 },
};

export function checkFileSize(files: FileContent[]): ScanResult[] {
  const results: ScanResult[] = [];

  for (const file of files) {
    const ext = "." + file.path.split(".").pop()?.toLowerCase();
    const lineCount = file.content.split("\n").length;
    const byteSize = new TextEncoder().encode(file.content).length;
    const fileName = file.path.split("/").pop() || "";

    // Check line count
    const lineThresholds = LINE_THRESHOLDS[ext];
    if (lineThresholds && lineCount > lineThresholds.warn) {
      const severity = lineCount > lineThresholds.error ? "warning" : "info";
      results.push({
        file: file.path,
        type: "architecture",
        severity: severity as "warning" | "info",
        message: `File "${fileName}" has ${lineCount} lines (threshold: ${lineThresholds.warn}). Consider splitting into smaller files.`,
        line: lineCount,
        codeSnippet: undefined,
        suggestion: `Break this file into smaller modules. Aim for < ${lineThresholds.warn} lines per file.`,
      });
    }

    // Check byte size
    const sizeThresholds = SIZE_THRESHOLDS[ext];
    if (sizeThresholds && byteSize > sizeThresholds.warn) {
      const sizeKB = (byteSize / 1024).toFixed(1);
      if (byteSize > sizeThresholds.error) {
        results.push({
          file: file.path,
          type: "architecture",
          severity: "warning",
          message: `File "${fileName}" is ${sizeKB}KB (threshold: ${(sizeThresholds.warn / 1024).toFixed(0)}KB). Unusually large.`,
          codeSnippet: undefined,
          suggestion: "Consider splitting this file or extracting heavy sections.",
        });
      }
    }
  }

  return results;
}

export function checkComponentArchitecture(files: FileContent[]): ScanResult[] {
  const results: ScanResult[] = [];

  for (const file of files) {
    const path = file.path;
    const name = path.split("/").pop()?.toLowerCase() || "";
    const isSvelte = path.endsWith(".svelte");

    if (!isSvelte) continue;

    const isDumbPath = DUMB_COMPONENT_PATTERNS.some(p => p.test(path));
    const isDumbName = DUMB_COMPONENT_NAMES.some(n => name.startsWith(n) || name.replace(/\.svelte$/, "") === n);
    const isPage = path.includes("/routes/") || name.startsWith("+page") || name.startsWith("+layout");
    const isDumbComponent = (isDumbPath || isDumbName) && !isPage;

    if (isDumbComponent) {
      for (const indicator of SMART_INDICATORS) {
        const match = file.content.match(indicator.regex);
        if (match) {
          const lineNum = getLineNumber(file.content, match.index!);
          results.push({
            file: path,
            type: "architecture",
            severity: indicator.severity as "warning" | "info",
            message: `Presentational component "${name}" ${indicator.msg}. Consider extracting logic to a container.`,
            line: lineNum,
            codeSnippet: extractLine(file.content, lineNum),
            suggestion: "Move state/logic to a parent container component and pass data via props.",
          });
        }
      }
    }

    if (isPage) {
      const hasScript = /<script/.test(file.content);
      const hasState = /\$state\s*\(/.test(file.content) || /\$derived\s*\(/.test(file.content);
      const hasEvents = /onclick\s*=\{/.test(file.content) || /on:click/.test(file.content);
      const lineCount = file.content.split("\n").length;

      if (hasScript && !hasState && !hasEvents && lineCount > 30) {
        results.push({
          file: path,
          type: "architecture",
          severity: "info",
          message: `Page component "${name}" has no state or event handlers despite having a script block. Consider if it should be a presentational component.`,
          suggestion: "Refactor as a dumb component or add container logic.",
        });
      }
    }
  }

  return results;
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function extractLine(content: string, lineNum: number): string | undefined {
  const lines = content.split("\n");
  return lines[lineNum - 1]?.trim().substring(0, 80);
}
