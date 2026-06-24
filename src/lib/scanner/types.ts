export interface ScanResult {
  file: string;
  type: "duplicate" | "unused" | "redundant" | "architecture" | "dependency" | "ai";
  severity: "warning" | "error" | "info";
  message: string;
  line?: number;
  column?: number;
  codeSnippet?: string;
  suggestion?: string;
}

export interface FileContent {
  path: string;
  content: string;
  type: string;
}

export interface DuplicateMatch {
  hash: string;
  files: Array<{
    path: string;
    startLine: number;
    endLine: number;
    content: string;
  }>;
}

export interface CSSClassInfo {
  name: string;
  file: string;
  line: number;
  usedIn: string[];
}

export interface ImportInfo {
  source: string;
  importedNames: string[];
  file: string;
  line: number;
  used: boolean;
}

export interface Config {
  include?: string[];
  exclude?: string[];
  threshold?: {
    duplicateLines?: number;
  };
  rules?: {
    duplicate?: boolean;
    unused?: boolean;
    redundant?: boolean;
    dependency?: boolean;
  };
}