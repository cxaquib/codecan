import { readFileSync, readdirSync, statSync } from "fs";
import { join, parse } from "path";
import type { FileContent } from "./types";

const DEFAULT_EXTENSIONS = [".js", ".ts", ".svelte", ".rs", ".css", ".html", ".json", ".toml"];

export function findFiles(
  target: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
  excludePatterns: string[] = ["node_modules", ".git", "target", "dist", "build", ".svelte-kit"]
): FileContent[] {
  const files: FileContent[] = [];
  const stats = statSync(target);

  if (stats.isFile()) {
    const ext = parse(target).ext;
    if (extensions.includes(ext) || extensions.length === DEFAULT_EXTENSIONS.length) {
      try {
        const content = readFileSync(target, "utf-8");
        files.push({
          path: target,
          content,
          type: getFileType(ext)
        });
      } catch (e) {
        // Skip files that can't be read
      }
    }
    return files;
  }

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !excludePatterns.some(pattern => fullPath.includes(pattern))) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = parse(entry.name).ext;
        if (extensions.includes(ext)) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            files.push({
              path: fullPath,
              content,
              type: getFileType(ext)
            });
          } catch (e) {
            // Skip files that can't be read
          }
        }
      }
    }
  }

  walk(target);
  return files;
}

function getFileType(ext: string): string {
  const map: Record<string, string> = {
    ".js": "javascript",
    ".ts": "typescript",
    ".svelte": "svelte",
    ".rs": "rust",
    ".css": "css",
    ".html": "html",
    ".json": "json",
    ".toml": "toml"
  };
  return map[ext] || "unknown";
}