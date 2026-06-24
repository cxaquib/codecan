import { scan } from "./lib/scanner/index";
import type { ScanResult } from "./lib/scanner/types";
import { resolve } from "path";
import { fileURLToPath } from "url";

interface ReportOptions {
  format?: "console" | "json";
  output?: string;
}

export function analyze(targetDir: string, options: ReportOptions = {}): ScanResult[] {
  const absoluteDir = resolve(targetDir);
  const results = scan(absoluteDir);

  if (options.format === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    reportConsole(results);
  }

  return results;
}

function reportConsole(results: ScanResult[]): void {
  const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
  };

  if (results.length === 0) {
    console.log(`${colors.cyan}${colors.bold}No issues found!${colors.reset}`);
    return;
  }

  console.log(`\n${colors.bold}Code Analysis Results:${colors.reset}\n`);

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, ScanResult[]>);

  for (const [type, items] of Object.entries(grouped)) {
    console.log(`${colors.cyan}${type.toUpperCase()} (${items.length}):${colors.reset}`);
    for (const item of items) {
      const severity = item.severity === "error" ? `${colors.red}ERROR${colors.reset}` : `${colors.yellow}WARNING${colors.reset}`;
      console.log(`  ${severity} ${item.file}:${item.line || "?"}`);
      console.log(`    ${item.message}`);
      if (item.codeSnippet) {
        console.log(`    ${colors.reset}${item.codeSnippet}`);
      }
    }
    console.log("");
  }
}

// CLI support
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const [, , command, dir = ".", format] = process.argv;
  if (command === "scan") {
    analyze(dir, { format: format as "console" | "json" });
  } else {
    console.log("Usage: npx tsx src/index.ts scan <directory> [json|console]");
  }
}