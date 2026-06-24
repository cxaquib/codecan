import type { ScanResult, FileContent } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const MAX_AI_FILES = 10;
const MAX_FILE_LINES = 80;

export interface AIModel {
  id: string;
  name: string;
  type: "local" | "cloud";
  provider?: "hf" | "openrouter";
  endpoint?: string;
}

export const AI_MODELS: AIModel[] = [
  { id: "local", name: "Qwen2.5-0.5B (Local)", type: "local" },
  { id: "openrouter/poolside/laguna-m.1:free", name: "Laguna M.1 (free)", type: "cloud", provider: "openrouter" },
  { id: "openrouter/meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", type: "cloud", provider: "openrouter" },
  { id: "openrouter/google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B (free)", type: "cloud", provider: "openrouter" },
  { id: "openrouter/openai/gpt-oss-120b:free", name: "GPT-OSS-120B (free)", type: "cloud", provider: "openrouter" },
  { id: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra (free)", type: "cloud", provider: "openrouter" },
  { id: "openrouter/qwen/qwen3-next-80b-a3b-instruct:free", name: "Qwen3 Next 80B (free)", type: "cloud", provider: "openrouter" },
  { id: "hf/Qwen/Qwen2.5-Coder-1.5B-Instruct", name: "Qwen2.5-Coder-1.5B (HF)", type: "cloud", provider: "hf", endpoint: "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-Coder-1.5B-Instruct" },
  { id: "hf/bigcode/starcoder2-3b", name: "StarCoder2-3B (HF)", type: "cloud", provider: "hf", endpoint: "https://api-inference.huggingface.co/models/bigcode/starcoder2-3b" },
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compressContent(content: string, maxLines = MAX_FILE_LINES): string {
  const lines = content.split("\n");
  const relevant: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("/*") || t.startsWith("*")) continue;
    relevant.push(line);
  }
  if (relevant.length <= maxLines) return relevant.join("\n");
  const head = relevant.slice(0, Math.floor(maxLines * 0.6));
  const tail = relevant.slice(-Math.floor(maxLines * 0.4));
  return [...head, "// ... truncated ...", ...tail].join("\n");
}

function buildSystemPrompt(): string {
  return `Analyze source code for quality issues.

For each issue, respond with one line in this exact format:
ISSUE|category|file|severity|description|suggestion

Category must be one of: duplicate, unused, redundant, architecture, dependency
Severity must be one of: error, warning, info

Categories to check:
- duplicate: Duplicate code, repeated logic, copy-pasted blocks
- unused: Unused imports, variables, functions, or dead code
- redundant: Overly complex code, deep nesting, too many parameters, unnecessary complexity
- architecture: Component structure violations, oversized files, poor separation of concerns
- dependency: Deprecated packages, unpinned versions, malicious packages, suspicious scripts

Respond with only the ISSUE lines, one per issue found. If no issues, respond with "NO_ISSUES_FOUND"`;
}

function buildUserPrompt(file: FileContent): string {
  const lines = file.content.split("\n").length;
  return `File: ${file.path} (${lines} lines, type: ${file.type})
\`\`\`
${file.content}
\`\`\``;
}

function buildFilePrompt(file: FileContent): string {
  return `${buildSystemPrompt()}

${buildUserPrompt(file)}`;
}

const CATEGORIES = new Set(["duplicate", "unused", "redundant", "architecture", "dependency"]);

function parseAIResponse(text: string, files: FileContent[]): ScanResult[] {
  const results: ScanResult[] = [];
  const filePaths = new Set(files.map(f => f.path));

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("ISSUE|")) continue;
    const parts = trimmed.split("|");
    if (parts.length < 5) continue;

    const [, category, file, severity, ...rest] = parts;
    if (!CATEGORIES.has(category)) continue;

    const messageAndSuggestion = rest.join("|");
    const suggestionIdx = messageAndSuggestion.lastIndexOf("|");

    let message: string;
    let suggestion: string | undefined;

    if (suggestionIdx > 0) {
      message = messageAndSuggestion.slice(0, suggestionIdx).trim();
      suggestion = messageAndSuggestion.slice(suggestionIdx + 1).trim();
    } else {
      message = messageAndSuggestion.trim();
    }

    const severityMap: Record<string, "warning" | "error" | "info"> = {
      warning: "warning",
      error: "error",
      info: "info",
    };

    const resolvedSeverity = severityMap[severity.toLowerCase()] || "info";
    const resolvedFile = filePaths.has(file) ? file : (files[0]?.path || "unknown");

    results.push({
      file: resolvedFile,
      type: category as ScanResult["type"],
      severity: resolvedSeverity,
      message,
      suggestion,
      codeSnippet: undefined,
    });
  }

  return results;
}

function fileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function stripModelPrefix(id: string): string {
  const idx = id.indexOf("/");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

export async function scanWithAI(
  files: FileContent[],
  modelId: string,
  apiToken?: string,
  onProgress?: (msg: string) => void,
  onTokens?: (count: number) => void,
): Promise<ScanResult[]> {
  if (files.length === 0) return [];

  const model = AI_MODELS.find(m => m.id === modelId);
  if (!model || model.type !== "cloud") {
    onProgress?.(`Unknown cloud model: ${modelId}`);
    return [];
  }

  const batch = files.slice(0, MAX_AI_FILES);
  const provider = model.provider || "hf";

  const inputs = batch.map(f => ({
    path: f.path,
    prompt: buildFilePrompt(f),
    user_prompt: buildUserPrompt(f),
    system_prompt: buildSystemPrompt(),
  }));

  const modelName = stripModelPrefix(modelId);
  const ep = model.endpoint || "";

  const unlisten = await listen<any>("ai-scan-progress", (event) => {
    const p = event.payload;
    if (p.status === "analyzing") {
      onProgress?.(`Analyzing ${fileName(p.file)} (${p.index}/${p.total})...`);
    } else if (p.status === "error") {
      onProgress?.(`${fileName(p.file)}: ERROR - ${p.error}`);
    } else if (p.status === "done") {
      onProgress?.(`${fileName(p.file)}: ${p.issues} issue(s) found (${p.index}/${p.total})`);
    }
  });

  try {
    const batchResults = await invoke<{ file: string; issues: ScanResult[]; error?: string }[]>("batch_ai_scan", {
      files: inputs,
      provider,
      model: modelName,
      apiToken: apiToken ?? "",
      endpoint: provider === "hf" ? ep : null,
    });
    const results: ScanResult[] = [];
    const errors: string[] = [];
    let totalTokens = 0;

    for (const br of batchResults) {
      totalTokens += estimateTokens(br.file);
      if (br.error) {
        errors.push(`${fileName(br.file)}: ${br.error}`);
      }
      results.push(...br.issues);
    }

    if (results.length === 0 && errors.length > 0) {
      onProgress?.(`AI scan completed with ${errors.length} error(s): ${errors.join("; ")}`);
    } else if (results.length === 0) {
      onProgress?.("AI scan returned no issues. The model may not be following the expected response format.");
    }

    onTokens?.(totalTokens);
    return results;
  } finally {
    unlisten();
  }
}

export async function getLocalModelStatus(): Promise<{ exists: boolean; path: string; size_mb: number }> {
  const raw = await invoke<string>("get_local_model_status");
  return JSON.parse(raw);
}

export async function ensureLocalModel(): Promise<string> {
  return await invoke<string>("ensure_local_model");
}

const LOCAL_MAX_TOKENS = 128;

export async function scanWithLocalAI(
  files: FileContent[],
  onProgress?: (msg: string) => void,
  onTokens?: (count: number) => void,
): Promise<ScanResult[]> {
  if (files.length === 0) {
    return [];
  }

  const batch = files.slice(0, MAX_AI_FILES);
  const compressed = batch.map(f => ({ ...f, content: compressContent(f.content) }));
  const prompts = compressed.map(f => buildFilePrompt(f));

  onProgress?.(`Local AI analyzing ${batch.length} files...`);

  try {
    const text = await invoke<string>("run_local_inference_batch", { prompts, maxTokens: LOCAL_MAX_TOKENS });
    const items: { text: string; token_count: number }[] = JSON.parse(text);
    const results: ScanResult[] = [];
    let totalTokens = 0;

    for (let i = 0; i < items.length; i++) {
      totalTokens += items[i].token_count;
      const fileResults = parseAIResponse(items[i].text, [compressed[i]]);
      results.push(...fileResults);
    }

    onTokens?.(totalTokens);

    return results;
  } catch (err) {
    onProgress?.(`Local AI error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export { checkConnectivity } from "./connectivity";
