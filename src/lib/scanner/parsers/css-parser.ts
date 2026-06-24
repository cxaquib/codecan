import type { CSSClassInfo, ScanResult } from "../types";

export function parseCSS(content: string, filePath: string): CSSClassInfo[] {
  const classes: CSSClassInfo[] = [];

  const { css } = extractStyleContent(content, filePath);
  const lines = css.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    if (match) {
      for (const m of match) {
        classes.push({
          name: m.substring(1),
          file: filePath,
          line: i + 1,
          usedIn: []
        });
      }
    }
  }

  return classes;
}

function extractStyleContent(content: string, filePath: string): { css: string; offset: number } {
  if (filePath.endsWith(".svelte")) {
    const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    if (!styleMatch) return { css: "", offset: 0 };

    // Calculate line offset
    const beforeStyle = content.substring(0, styleMatch.index!);
    const offset = (beforeStyle.match(/\n/g) || []).length + 1;
    return { css: styleMatch[1], offset };
  }
  return { css: content, offset: 0 };
}

export function findDuplicateRules(
  content: string,
  filePath: string
): ScanResult[] {
  const results: ScanResult[] = [];

  const { css, offset } = extractStyleContent(content, filePath);
  const lines = css.split("\n");

  if (!lines.length) return results;

  const ruleMap = new Map<string, { line: number; content: string }[]>();

  let currentRuleStart: number | null = null;
  let currentRuleSelectors: string | null = null;
  let braceDepth = 0;
  let inMediaQuery = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Track media query context
    if (trimmedLine.startsWith("@media") || trimmedLine.startsWith("@supports")) {
      inMediaQuery = true;
    }

    // Count braces to find rule start/end
    const openBraces = (trimmedLine.match(/{/g) || []).length;
    const closeBraces = (trimmedLine.match(/}/g) || []).length;
    const hasBrace = openBraces > 0;

    // Check if this line starts a CSS rule (selector followed by {)
    const ruleMatch = trimmedLine.match(/^([#\.a-zA-Z0-9_:,\s-]+)\{/);
    if (braceDepth === 0 && hasBrace) {
      let fullSelector = "";

      if (ruleMatch && ruleMatch[1]) {
        fullSelector = ruleMatch[1].trim();

        // Check if previous line was a continuation of selector (for multi-line selectors like "input,\nbutton {")
        if (i > 0 && !lines[i - 1].includes("{") && !lines[i - 1].includes("}")) {
          const prevTrimmed = lines[i - 1].trim();
          if (prevTrimmed && !prevTrimmed.startsWith("@")) {
            fullSelector = prevTrimmed + "," + fullSelector;
          }
        }
      }

      if (fullSelector) {
        const selector = fullSelector.split(",").map(s => s.trim()).filter(Boolean).sort().join(",");

        currentRuleStart = i + 1;
        currentRuleSelectors = selector;

        const contextPrefix = inMediaQuery ? "media-" : "root-";
        const mapKey = `${contextPrefix}${selector}`;

        if (!ruleMap.has(mapKey)) {
          ruleMap.set(mapKey, []);
        }
      }
    }

    braceDepth += openBraces;
    braceDepth -= closeBraces;

    // Reset media query flag when back to root level
    if (braceDepth === 0) {
      inMediaQuery = false;
    }

    // Rule ended - record the rule
    if (braceDepth === 0 && closeBraces > 0 && currentRuleSelectors && currentRuleStart) {
      // Find the matching key (context may have changed)
      const matchedKey = Array.from(ruleMap.keys()).find(k => {
        const selectors = k.replace(/^(media-|root-)/, "");
        return selectors === currentRuleSelectors;
      });
      if (matchedKey) {
        ruleMap.get(matchedKey)!.push({
          line: currentRuleStart + offset,
          content: lines.slice(currentRuleStart - 1, i + 1).join("\n")
        });
      }
      currentRuleStart = null;
      currentRuleSelectors = null;
    }
  }

  // Find selectors that appear multiple times in same context
  for (const [mapKey, occurrences] of ruleMap.entries()) {
    if (occurrences.length > 1) {
      const selector = mapKey.replace(/^(media-|root-)/, "");
      results.push({
        file: filePath,
        type: "duplicate",
        severity: "warning",
        message: `CSS rule "${selector}" is defined ${occurrences.length} times in the same context`,
        line: occurrences[0].line,
        codeSnippet: occurrences[0].content.substring(0, 100) + "..."
      });
    }
  }

  return results;
}