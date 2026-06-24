# Codecan Architecture Reference

> AI-friendly reference for the Codecan codebase. Every file, command, data flow, and design decision is documented here so that future development can be done efficiently by AI agents or human developers.

---

## 1. Project Identity

| Aspect | Value |
|--------|-------|
| **Name** | Codecan |
| **Version** | 0.1.0 |
| **Author** | Aquib Shahbaz |
| **License** | MIT |
| **Description** | Desktop app to scan source code repos for quality issues (duplicate code, unused imports, redundant patterns, architecture violations, dependency risks) with optional AI-powered analysis. |
| **Tech Stack** | Tauri v2 (Rust backend) + SvelteKit 5 (TypeScript frontend) + Tailwind CSS v4 |
| **Rust HTTP Client** | `ureq` (blocking) for Hugging Face & OpenRouter API calls |
| **Local AI** | `llama-cpp-2` crate for GGUF model inference |
| **Entry Points** | Desktop: `src-tauri/src/main.rs` → `lib.rs::run()`, CLI: `src/index.ts`, Web build: `build/index.html` |

---

## 2. Directory Map

```
codecan/
├── .codecan.json                        # API key config (git-committed, template)
├── package.json                         # npm scripts, deps (SvelteKit, Tauri API, Tailwind)
├── vite.config.js                       # Port 1420, Tauri HMR, SPA mode
├── svelte.config.js                     # adapter-static with index.html fallback (SPA)
├── vitest.config.js                     # node env, test patterns
├── postcss.config.js                    # Tailwind v4 + Autoprefixer
├── tailwind.config.js                   # Content paths for editor intellisense
│
├── src/                                 # Frontend (SvelteKit + TypeScript)
│   ├── app.html                         # HTML shell with %sveltekit.head/body%
│   ├── app.css                          # Tailwind imports, dark variant, custom theme colors
│   ├── index.ts                         # CLI entry: npm run analyze (console/json output)
│   └── routes/
│       ├── +layout.svelte               # Root layout, imports app.css
│       ├── +layout.js                   # ssr = false (SPA mode)
│       └── +page.svelte                 # MAIN UI (765 lines): scan buttons, model selector,
│                                        #   API key mgmt, results display, timer, dark mode, help
│
├── src/lib/scanner/                     # Scanner library (shared: Tauri + CLI)
│   ├── types.ts                         # ScanResult, FileContent, DuplicateMatch, Config, etc.
│   ├── index.ts                         # scan() orchestrator: calls all detectors
│   ├── file-finder.ts                   # Recursive file walker (extension filter, skip dirs)
│   ├── connectivity.ts                  # checkConnectivity() → pings HF API status
│   ├── ai-scanner.ts                    # AI scanning: model list, prompt builders,
│   │                                    #   scanWithAI() (cloud), scanWithLocalAI() (local)
│   │
│   ├── detectors/
│   │   ├── redundant.ts                 # Deep nesting, long params, duplicate vars
│   │   ├── component-architecture.ts    # Dumb-component logic detection + file size checks
│   │   └── dependency.ts               # Deprecated/malicious npm packages, cargo crates,
│   │                                    #   typosquatting (Levenshtein distance), unpinned versions
│   │
│   ├── parsers/
│   │   ├── css-parser.ts               # CSS class extraction, duplicate selector detection
│   │   ├── js-parser.ts                # ES6 import parsing, unused import detection
│   │   ├── rust-parser.ts              # Rust use-statement parsing, unused + duplicate functions
│   │   └── svelte-parser.ts            # Svelte script/CSS extraction, duplicate style blocks
│   │
│   └── __tests__/                       # Vitest test suites (6 files)
│       ├── scanner.test.ts              # Integration: scans test-fixtures/ validates all categories
│       ├── dependency.test.ts           # Deprecated/malicious/unpinned/scripts/Cargo checks
│       ├── unused.test.ts               # JS/TS + Rust import parsing
│       ├── redundant.test.ts            # Nesting, params, duplicate vars
│       ├── duplicate.test.ts            # CSS rules, Rust functions, Svelte styles
│       └── architecture.test.ts         # Component violations, file size thresholds
│
├── src-tauri/                           # Rust backend (Tauri v2)
│   ├── Cargo.toml                       # tauri 2, serde, ureq, llama-cpp-2, tokio
│   ├── tauri.conf.json                  # App window config, security, bundle settings
│   ├── build.rs                         # tauri_build::build()
│   └── src/
│       ├── main.rs                      # Calls tauri_app_lib::run()
│       ├── lib.rs                       # 1409 lines: ALL Tauri commands + scan logic
│       └── local_llm.rs                 # 196 lines: GGUF model loading, inference, download
│
├── test-fixtures/                       # Synthetic test data
│   ├── package.json                     # Deprecated + malicious + unpinned deps
│   ├── bad-code.js                      # Unused imports, duplicate consts/functions, long params
│   ├── redundant-code.js                # 16-param function, 7-level nesting, duplicate vars
│   ├── styles.css                       # Duplicate .btn-primary, .card selectors
│   └── components/Badge.svelte          # Dumb component with $state/onMount/fetch (violation)
│
├── docs/                                # Documentation
│   ├── README.md                        # Docs index, feature list, CLI usage
│   ├── ARCHITECTURE.md                  # This file — comprehensive reference
│   └── features/
│       └── code-analyzer-plan.md        # Original implementation plan
│
├── static/                              # Icons: svelte.svg, vite.svg, tauri.svg, favicon.png
└── build/                               # SvelteKit static build output (adapter-static SPA)
```

---

## 3. Rust Backend — All Tauri Commands

Registered in `src-tauri/src/lib.rs:1392-1406`. 13 commands total.

### 3.1 Rule-Based Scanning

#### `scan_code` — `lib.rs:36-79`
```rust
async fn scan_code(
    path: Option<String>,             // File or directory path (None = ".")
    scan_id: String,                  // Unique ID for cancellation
    cancel_state: State<CancellationState>,
) -> Result<String, String>          // JSON: Vec<ScanResult>
```
- Creates an `AtomicBool` cancel flag keyed by `scan_id` in `CancellationState`
- Runs `scan_directory()` or `scan_single_file()` in `spawn_blocking`
- For each file, dispatches by extension to extension-specific detectors
- Returns JSON array of `ScanResult`

**Extension dispatch** (`lib.rs:81-132`):
| Extension | Detectors Applied |
|-----------|------------------|
| `.svelte`, `.css` | `check_file_size`, `find_duplicate_css_rules`, `find_redundant_code` (+ `check_component_architecture` for Svelte) |
| `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs` | `check_file_size`, `find_unused_js_imports`, `find_redundant_code` |
| `.rs` | `check_file_size`, `find_unused_rust_imports`, `find_redundant_code` |
| `.html` | `check_file_size`, `find_duplicate_css_rules`, `find_redundant_code` |
| `.json` | `check_file_size`, `check_npm_dependencies` (only if `package.json`) |
| `.toml` | `check_file_size`, `check_cargo_dependencies` (only if `Cargo.toml`) |

**Directory walk** (`lib.rs:208-244`): Recursive, skips dot-dirs + `node_modules`/`target`/`dist`/`build`, filters by extension list, skips files > 1 MB.

#### `cancel_scan` — `lib.rs:1357-1363`
```rust
fn cancel_scan(
    scan_id: String,
    state: State<CancellationState>,
) -> Result<(), String>
```
Sets the `AtomicBool` flag for the given scan ID. The scanning loop checks this flag on each iteration.

### 3.2 AI Scanning

#### `read_files_for_ai` — `lib.rs:838-899`
```rust
async fn read_files_for_ai(
    path: String,
    scan_id: String,
    cancel_state: State<CancellationState>,
) -> Result<String, String>          // JSON: Vec<FileContent>
```
Walks a directory collecting file contents. Supports cancellation. Files collected:
- Extensions: `.js`, `.ts`, `.svelte`, `.rs`, `.css`, `.html`, `.json`, `.toml`
- Excluded dirs: `node_modules`, `.git`, `target`, `dist`, `build`, `.svelte-kit`
- Returns JSON array of `{path, content, type}`

#### `batch_ai_scan` — `lib.rs:1098-1213`
```rust
async fn batch_ai_scan(
    files: Vec<BatchFileInput>,       // {path, prompt, user_prompt, system_prompt}
    provider: String,                  // "openrouter" | "hf"
    model: String,                     // Model slug (prefix stripped)
    api_token: String,                 // API key
    endpoint: Option<String>,          // HF endpoint URL (null for OpenRouter)
    app: AppHandle,                    // For emitting progress events
) -> Result<Vec<AiBatchResult>, String> // {file, issues[], error?}
```
- **Async**: Body wrapped in `tokio::task::spawn_blocking`
- Iterates over files sequentially (one request at a time)
- Emits `ai-scan-progress` events before and after each file
- For OpenRouter: `POST https://openrouter.ai/api/v1/chat/completions` with chat format
- For Hugging Face: `POST <endpoint>` with `{"inputs": prompt, "options": {"wait_for_model": true}}`
- Each response parsed with `parse_ai_response()` for `ISSUE|` format
- Per-file errors are captured in `AiBatchResult.error` (does NOT abort the entire batch)

**Key data structures** (`lib.rs:1036-1059`):
```rust
struct AiFileProgress { index, total, file, status, error?, issues }
struct AiBatchResult  { file, issues: Vec<ScanResult>, error? }
struct BatchFileInput { path, prompt, user_prompt, system_prompt }
```

#### `call_hf_api` — `lib.rs:901-965` (legacy, single-file)
```rust
fn call_hf_api(
    prompt: String,
    endpoint: String,
    api_token: Option<String>,
) -> Result<String, String>
```
Sends to Hugging Face Inference API. Used by old sequential path (no longer called from frontend).

#### `call_openrouter_api` — `lib.rs:973-1034` (legacy, single-file)
```rust
fn call_openrouter_api(
    model: String,
    messages: Vec<OpenRouterMessage>,
    api_token: String,
) -> Result<String, String>
```
Sends to OpenRouter chat completions. Used by old sequential path (no longer called from frontend).

### 3.3 Local AI

#### `get_local_model_status` — `lib.rs:1294-1302`
```rust
fn get_local_model_status(
    state: State<LocalModelState>,
) -> Result<String, String>          // JSON: {exists, path, size_mb}
```

#### `ensure_local_model` — `lib.rs:1304-1308`
```rust
fn ensure_local_model(
    state: State<LocalModelState>,
) -> Result<String, String>
```
Downloads Qwen2.5-0.5B-Instruct GGUF (~350 MB) from Hugging Face to app data dir.

#### `run_local_inference` — `lib.rs:1311-1328`
```rust
async fn run_local_inference(
    prompt: String,
    state: State<LocalModelState>,
) -> Result<String, String>          // JSON: {text, token_count}
```

#### `run_local_inference_batch` — `lib.rs:1331-1354`
```rust
async fn run_local_inference_batch(
    prompts: Vec<String>,
    max_tokens: Option<u32>,
    state: State<LocalModelState>,
) -> Result<String, String>          // JSON: [{text, token_count}]
```

### 3.4 API Key Management

#### `get_env_api_keys` — `lib.rs:1282-1285`
Loads keys from env vars (`HF_API_KEY`, `OPENROUTER_API_KEY`) + config files (`CODECAN_CONFIG`, `~/.codecan.json`, `.codecan.json` via upwards search).

#### `get_dir_api_keys` — `lib.rs:1288-1291`
```rust
fn get_dir_api_keys(
    directory: String,
) -> Result<String, String>           // JSON: [{id, name, key, predefined?}]
```
Loads keys from `<directory>/.codecan.json`.

### 3.5 Local Model Backend — `src-tauri/src/local_llm.rs`

| Method | Line | Description |
|--------|------|-------------|
| `new(app_data_dir)` | 34 | Sets path to `<app_data>/qwen2.5-0.5b-instruct-q4_k_m.gguf` |
| `exists()` | 40 | Checks file existence |
| `file_size_mb()` | 44 | Returns file size in MB |
| `download()` | 50 | Downloads ~350 MB GGUF from Hugging Face with progress |
| `generate(prompt, max_tokens)` | 100 | Single inference, returns `(text, token_count)` |
| `generate_batch(prompts, max_tokens)` | 106 | Sequential inference for multiple prompts |

**Inference parameters** (`local_llm.rs:131-133`):
- Context: 2048 tokens
- Batch: 512
- Max output: `max_tokens` (default 512)
- Sampler: Greedy
- Token limit guard: prompt must be ≤ 1800 tokens, output ≤ 4096 chars

**Prompt format** for local model (`local_llm.rs:139-142`):
```
<|im_start|>system
You are a code review assistant. Analyze source code and report issues.
<|im_end|>
<|im_start|>user
{prompt}
<|im_end|>
<|im_start|>assistant
```

---

## 4. Frontend — Key Modules

### 4.1 Main UI — `src/routes/+page.svelte`

**State variables** (all `$state`):
| Variable | Type | Purpose |
|----------|------|---------|
| `selectedDirectory` | `string` | File/folder path to scan |
| `scanResults` | `ScanResult[]` | All accumulated results |
| `totalTokens` | `number` | AI token counter |
| `isScanning` / `isAIScanning` | `boolean` | Active scan type |
| `error` | `string` | Error messages (red box) |
| `scanInfo` | `string` | Info/error messages (amber box) |
| `selectedModelId` | `string` | Selected AI model from dropdown |
| `apiKeys` | `ApiKeyEntry[]` | Loaded API keys |
| `activeKeyId` | `string` | Currently selected key |
| `elapsedSeconds` | `number` | Timer counter |
| `darkMode` | `boolean` | Dark/light theme |

**Scan buttons**:
| Button | Function | Calls |
|--------|----------|-------|
| "Scan" | `runScan()` (line 173) | `invoke("scan_code")` — rule-based |
| "Scan with AI" | `runAIScan()` (line 343) | `read_files_for_ai` → `scanWithAI()` or `scanWithLocalAI()` |
| "Scan This Project" | `scanCurrentProject()` (line 218) | Sets dir to `"."` then `runScan()` |
| "Stop" | `stopScan()` (line 204) | `invoke("cancel_scan")` |

**Results display**: 5 collapsible categories (duplicate, unused, redundant, architecture, dependency), each with severity badges (error=red, warning=amber, info=blue), file path, line number, and code snippet.

### 4.2 AI Scanner — `src/lib/scanner/ai-scanner.ts`

**Model definitions** (line 16-26):
```
9 models total: 1 local (Qwen2.5-0.5B), 6 OpenRouter (free tier), 2 Hugging Face
Model ID format: "<provider>/<model-slug>" (e.g. "openrouter/meta-llama/llama-3.3-70b-instruct:free")
```

**Key functions**:

| Function | Line | Purpose |
|----------|------|---------|
| `buildSystemPrompt()` | 47 | Returns the system prompt telling AI how to format responses |
| `buildUserPrompt(file)` | 66 | Returns user prompt with file path, line count, type, and content |
| `buildFilePrompt(file)` | 74 | Combined system + user prompt (used for HF API which doesn't support separate system messages) |
| `compressContent(content)` | 32 | Strips comments/empty lines, keeps first 60% + last 40% of 80-line window |
| `estimateTokens(text)` | 28 | `ceil(text.length / 4)` |
| `parseAIResponse(text, files)` | 82 | Parses `ISSUE|` lines from AI response into `ScanResult[]` |
| `scanWithAI(files, modelId, apiToken, onProgress, onTokens)` | 140 | Cloud AI scan: calls `batch_ai_scan` with progress events |
| `scanWithLocalAI(files, onProgress, onTokens)` | 264 | Local AI scan: calls `run_local_inference_batch` |
| `stripModelPrefix(id)` | 135 | Removes provider prefix (e.g. `"openrouter/"` → `""`) |

**Progress event flow** (`scanWithAI`, line 168-177):
```typescript
const unlisten = await listen<any>("ai-scan-progress", (event) => {
    // event.payload: { index, total, file, status, error?, issues }
    // status: "analyzing" | "error" | "done"
});
```

**Constants**:
| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_AI_FILES` | 10 | Max files sent to AI |
| `MAX_FILE_LINES` | 80 | Max lines per file after compression |
| `LOCAL_MAX_TOKENS` | 128 | Max tokens for local model output |

### 4.3 Scanner Library — `src/lib/scanner/index.ts`

**`scan(directory, config)`** orchestrator (line 10-68):
1. `findFiles(directory)` — walks dir, returns typed `FileContent[]`
2. Filter by type: css/svelte, javascript/typescript, rust, other
3. Run detectors based on `config.rules`:
   - `rules.duplicate !== false` → CSS duplicate rules + Rust duplicate functions
   - `rules.unused !== false` → JS/TS unused imports + Rust unused imports
   - `rules.redundant !== false` → Deep nesting, long params, duplicate vars (excludes rust files)
   - Always runs: component architecture + file size checks
   - `rules.dependency !== false` → Deprecated/malicious npm, cargo checks

### 4.4 Connectivity — `src/lib/scanner/connectivity.ts`

```typescript
function checkConnectivity(): Promise<boolean>
```
HEAD requests to `https://huggingface.co/api/status` with 5s timeout. Used to gate "Scan with AI" button when no local model is available.

### 4.5 CLI — `src/index.ts`

```
npm run analyze              # npx tsx src/index.ts scan .
npm run analyze:json         # npx tsx src/index.ts scan . json
```
Imports and calls `scan()` from the scanner library, outputs to console (colorized) or JSON.

---

## 5. Data Structures

### 5.1 `ScanResult` — `src-tauri/src/lib.rs:24-34` / `src/lib/scanner/types.ts:1-10`
```typescript
{
  file: string;           // Path to file
  type: "duplicate" | "unused" | "redundant" | "architecture" | "dependency" | "ai";
  severity: "warning" | "error" | "info";
  message: string;        // Human-readable description
  line?: number;          // Line number (optional)
  column?: number;        // Column number (optional)
  codeSnippet?: string;   // Relevant code excerpt (optional)
  suggestion?: string;    // Fix suggestion (optional)
}
```

### 5.2 `FileContent` — `src-tauri/src/lib.rs:777-782` / `src/lib/scanner/types.ts:12-16`
```typescript
{
  path: string;     // Absolute path
  content: string;  // Full file content
  type: string;     // "javascript" | "typescript" | "svelte" | "rust" | "css" | "html" | "json" | "toml"
}
```

### 5.3 `Config` — `src/lib/scanner/types.ts:43-55`
```typescript
{
  include?: string[];       // File extensions to include
  exclude?: string[];       // Directories to exclude
  threshold?: { duplicateLines?: number };
  rules?: {
    duplicate?: boolean;
    unused?: boolean;
    redundant?: boolean;
    dependency?: boolean;
  };
}
```

---

## 6. Data Flow Diagrams

### 6.1 Rule-Based Scan

```
User clicks "Scan"
  │
  ▼
runScan() [src/routes/+page.svelte:173]
  ├── generateId() → currentScanId
  ├── startTimer() → setInterval every 1s
  │
  ▼
invoke("scan_code", { path, scanId })      [lib.rs:36]
  ├── CancellationState: insert cancel_flag
  │
  ▼
tokio::task::spawn_blocking
  ├── scan_directory(dir)                    [lib.rs:208]
  │     └── for each file:
  │           └── filter by extension + size
  │                 └── scan_single_file(path)  [lib.rs:81]
  │                       └── match extension:
  │                             .svelte → check_file_size
  │                                       find_duplicate_css_rules
  │                                       find_redundant_code
  │                                       check_component_architecture
  │                             .js/.ts → check_file_size
  │                                       find_unused_js_imports
  │                                       find_redundant_code
  │                             .rs     → check_file_size
  │                                       find_unused_rust_imports
  │                                       find_redundant_code
  │                             .json   → check_file_size
  │                                       check_npm_dependencies (package.json only)
  │                             .toml   → check_file_size
  │                                       check_cargo_dependencies (Cargo.toml only)
  │
  ▼
Returns: JSON Vec<ScanResult>
  │
  ▼
+page.svelte: JSON.parse → mapResult → display in categories
```

### 6.2 AI Cloud Scan

```
User selects cloud model, selects API key, clicks "Scan with AI"
  │
  ▼
runAIScan() [src/routes/+page.svelte:343]
  │
  ▼
invoke("read_files_for_ai", { path, scanId })    [lib.rs:838]
  │
  ▼
Returns: JSON Vec<FileContent>
  │
  ▼
ai-scanner.ts: scanWithAI(files, modelId, apiToken, onProgress, onTokens)   [line 140]
  │
  ├── Slice to MAX_AI_FILES (10)
  ├── Build BatchFileInput[] (path, prompt, user_prompt, system_prompt)
  ├── listen("ai-scan-progress") → register event handler
  │
  ▼
invoke("batch_ai_scan", { files, provider, model, apiToken, endpoint })   [lib.rs:1098]
  │
  ├── tokio::task::spawn_blocking
  │     └── for each file (sequential):
  │           ├── app.emit("ai-scan-progress", { status: "analyzing", ... })
  │           ├── HTTP call:
  │           │     OpenRouter → POST https://openrouter.ai/api/v1/chat/completions
  │           │                   { model, messages: [{system}, {user}], max_tokens: 512 }
  │           │     HuggingFace → POST <endpoint>
  │           │                   { inputs: prompt, options: { wait_for_model: true } }
  │           ├── parse_ai_response() → extract ISSUE| lines → Vec<ScanResult>
  │           └── app.emit("ai-scan-progress", { status: "done"|"error", issues: N, ... })
  │
  ▼
Returns: Vec<AiBatchResult> { file, issues[], error? }
  │
  ▼
Frontend receives batchResults (Tauri auto-deserializes from JSON)
  ├── for each result: accumulate ScanResults, count tokens
  ├── if errors: report via onProgress callback
  └── return results → merge into scanResults[]
```

### 6.3 AI Local Scan

```
runAIScan() + isLocalModel
  │
  ▼
ai-scanner.ts: scanWithLocalAI(files, onProgress, onTokens)   [line 264]
  │
  ├── Compress content (80 lines max, strip comments/empties)
  ├── Build prompts with buildFilePrompt()
  │
  ▼
invoke("run_local_inference_batch", { prompts, maxTokens: 128 })   [lib.rs:1331]
  │
  ├── tokio::task::spawn_blocking
  │     └── llama_cpp_2: load GGUF → tokenize → greedy decode → collect
  │
  ▼
Returns: JSON [{text, token_count}]
  │
  ▼
Frontend: parseAIResponse() for each → merge results
```

---

## 7. AI Integration Details

### 7.1 AI Response Format

The system prompt tells the AI to respond with:
```
ISSUE|category|file|severity|description|suggestion
```

- **Categories**: `duplicate`, `unused`, `redundant`, `architecture`, `dependency`
- **Severities**: `error`, `warning`, `info`
- **Fallback**: If no issues, respond with exactly `NO_ISSUES_FOUND`

Parsed by `parse_ai_response()` in both Rust (`lib.rs:1061-1096`) and TypeScript (`ai-scanner.ts:82-128`). Both implementations handle:
- Missing trailing suggestion (optional)
- Malformed lines (skipped)
- Invalid categories (skipped)
- Empty file path (falls back to default file)

### 7.2 System Prompt (exact) — `ai-scanner.ts:47-63`
```
Analyze source code for quality issues.

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

Respond with only the ISSUE lines, one per issue found. If no issues, respond with "NO_ISSUES_FOUND"
```

### 7.3 User Prompt (exact) — `ai-scanner.ts:66-72`
```
File: {path} ({lines} lines, type: {type})
```
{content}
```

### 7.4 Model List

| ID | Name | Provider | Endpoint |
|----|------|----------|----------|
| `local` | Qwen2.5-0.5B (Local) | local (llama.cpp) | — |
| `openrouter/poolside/laguna-m.1:free` | Laguna M.1 (free) | OpenRouter | — |
| `openrouter/meta-llama/llama-3.3-70b-instruct:free` | Llama 3.3 70B (free) | OpenRouter | — |
| `openrouter/google/gemma-4-26b-a4b-it:free` | Gemma 4 26B (free) | OpenRouter | — |
| `openrouter/openai/gpt-oss-120b:free` | GPT-OSS-120B (free) | OpenRouter | — |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | Nemotron 3 Ultra (free) | OpenRouter | — |
| `openrouter/qwen/qwen3-next-80b-a3b-instruct:free` | Qwen3 Next 80B (free) | OpenRouter | — |
| `hf/Qwen/Qwen2.5-Coder-1.5B-Instruct` | Qwen2.5-Coder-1.5B (HF) | Hugging Face | `https://api-inference.huggingface.co/models/Qwen/Qwen2.5-Coder-1.5B-Instruct` |
| `hf/bigcode/starcoder2-3b` | StarCoder2-3B (HF) | Hugging Face | `https://api-inference.huggingface.co/models/bigcode/starcoder2-3b` |

### 7.5 Token Estimation
```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```
Rough estimate: 1 token ≈ 4 characters.

### 7.6 File Compression — `ai-scanner.ts:32-45`
Before sending to AI, files are compressed:
1. Strip empty lines
2. Strip comment lines (`//`, `#`, `/*`, `*`)
3. If still > 80 lines: keep first 60% and last 40%, with `// ... truncated ...` in between

---

## 8. API Key Management

### 8.1 Key Loading Priority Chain

The `get_env_api_keys` command (`lib.rs:1233-1270`) loads keys in this order (later sources override duplicates by key value):

1. **Environment variables**: `HF_API_KEY`, `OPENROUTER_API_KEY`
2. **`CODECAN_CONFIG` env var**: Points to a JSON config file path
3. **`~/.codecan.json`**: Home directory config
4. **`.codecan.json` upwards search**: `find_upwards()` walks up from CWD (`lib.rs:1220-1231`)
5. **`<directory>/.codecan.json`**: Per-directory config (via `get_dir_api_keys`, `lib.rs:1272-1279`)
6. **`localStorage`**: User-entered keys via the UI, persisted as `codecan-api-keys`

### 8.2 `.codecan.json` Format
```json
{
    "apiKeys": [
        {"name": "My HF Key", "key": "hf_..."},
        {"name": "My OpenRouter Key", "key": "sk-or-v1-..."}
    ]
}
```

### 8.3 `localStorage` Keys
| Key | Purpose |
|-----|---------|
| `codecan-api-keys` | User-entered keys (filtered: only non-predefined) |
| `codecan-active-key` | Currently selected key ID |
| `codecan-selected-model` | Last selected model ID |

### 8.4 Key ID Generation — `lib.rs:1215-1218`
```rust
fn make_predefined_key(name: &str, key: &str) -> serde_json::Value
```
Predefined keys get IDs like `env-<sanitized-name>`. Both predefined and user keys have `{id, name, key, predefined: bool}`.

---

## 9. Testing

| Aspect | Details |
|--------|---------|
| **Runner** | Vitest v4 |
| **Config** | `vitest.config.js` — `node` environment, pattern `src/lib/scanner/__tests__/**/*.test.ts` |
| **Run command** | `npm test` (vitest run) / `npm run test:watch` |
| **Test files** | 6 files in `src/lib/scanner/__tests__/` |
| **Fixtures** | 5 files in `test-fixtures/` |

### 9.1 Test Coverage

| Test File | What It Tests |
|-----------|---------------|
| `scanner.test.ts` | Integration: scans `test-fixtures/`, validates all categories present, valid severities, non-empty files, and specific expected messages |
| `dependency.test.ts` | Deprecated packages, malicious packages, unpinned versions, script hooks, invalid JSON, Cargo.toml wildcard + deprecated crates |
| `unused.test.ts` | JS/TS import parsing (named/default/namespace), unused import detection, Rust import parsing |
| `redundant.test.ts` | Deep nesting (>32 spaces), long param lists (>8), duplicate variable declarations on consecutive lines |
| `duplicate.test.ts` | CSS duplicate rules (finds duplicates, ignores unique, handles Svelte style blocks), Rust duplicate functions (cross-file) |
| `architecture.test.ts` | Dumb components with `$state`/`onMount`/`fetch`/`invoke`, route pages excluded, file size thresholds |

### 9.2 Writing New Tests Pattern
```typescript
import { describe, it, expect } from "vitest";
import { yourFunction } from "../your-module";

describe("feature name", () => {
  it("should do what", () => {
    const result = yourFunction(input);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].severity).toBe("warning");
    // etc.
  });
});
```

---

## 10. Key Design Decisions

### 10.1 Why Rust for Scanning Instead of TypeScript
- **Performance**: File system traversal and string pattern matching are faster in Rust
- **Tauri integration**: Direct access to file system without IPC overhead for scanning
- **Cancellation**: `AtomicBool` flags are simpler in Rust's threading model
- **Two implementations coexist**: Rust `scan_code` (Tauri) + TypeScript `scan()` (CLI) both work independently

### 10.2 Why Single `batch_ai_scan` IPC Instead of Sequential `invoke`s
The original implementation called `call_openrouter_api` / `call_hf_api` once per file via separate `invoke` calls. This caused the app to freeze because:
- Each `invoke` blocked the frontend waiting for a response
- The frontend's event loop couldn't process timer callbacks or Tauri events between invokes

**Fix**: A single `batch_ai_scan` command that processes all files in one IPC call and emits progress via `app.emit("ai-scan-progress", ...)`. The command runs asynchronously on Tokio's blocking threadpool, and the frontend listens for progress events independently of the invoke response.

### 10.3 Why `ISSUE|` Pipe-Delimited Format for AI Output
- **Parseable**: Simple `split("|")` produces structured fields — no fragile JSON parsing of AI output
- **Multi-issue**: One line per issue, clearly delimited
- **Graceful degradation**: Unparseable lines are skipped, partial results are preserved
- **Hallucination-resistant**: The constrained format makes it harder for AI to produce invalid output

### 10.4 Why Sync Commands for `call_hf_api`/`call_openrouter_api`
These are synchronous functions in Rust but they don't freeze the UI because:
- In Tauri v2, sync commands run on a threadpool (not the main webview thread)
- The JS `invoke` returns a Promise, allowing the event loop to continue
- The new `batch_ai_scan` wraps everything in `tokio::task::spawn_blocking`

### 10.5 SPA Mode for Tauri
- `+layout.js` sets `export const ssr = false`
- `svelte.config.js` uses `adapter-static` with `fallback: "index.html"`
- This avoids conflicts between SvelteKit's server routing and Tauri's file system

### 10.6 Duplicate Scanner Implementations
- **Rust backend** (`lib.rs:81-132`): Used by the desktop app via `invoke("scan_code")`. Has per-extension dispatch, CSS rule dedup, import analysis, component architecture checks, dependency checking.
- **TypeScript CLI** (`src/lib/scanner/index.ts`): Used by `npm run analyze`. Feature-parallel but independent implementation. Shares types but not code.

---

## 11. Common Errors & Debugging

### 11.1 "JSON Parse error: Unexpected identifier 'object'"
**Cause**: `invoke<string>()` returns a JS object (Tauri deserializes the response), then `JSON.parse(object)` produces `"[object Object]"` which fails.
**Fix**: Use `invoke<T>()` without `JSON.parse` — Tauri already handles deserialization.

### 11.2 App Freezes During AI Scan
**Cause**: Multiple sequential `invoke` calls each waiting for HTTP response, blocking the frontend's event loop.
**Fix**: Ensure `batch_ai_scan` is used (single IPC call with progress events), and that it's `async` with `spawn_blocking`.

### 11.3 "OpenRouter returned 400"
**Cause**: Incorrect model slug. OpenRouter model IDs must use their exact format (e.g., `openai/gpt-oss-120b:free`, not `gpt-oss/gpt-oss-120b:free`).
**Check**: `stripModelPrefix()` removes the `openrouter/` prefix before sending.

### 11.4 Local Model Prompt Too Long
**Cause**: Total tokenized prompt exceeds 1800 tokens. The local context window is 2048 with 1800 token guard.
**Fix**: Reduce `MAX_AI_FILES` or `MAX_FILE_LINES` constants.

---

## 12. Build & Run Commands

```bash
npm run dev                 # Vite dev server (browser-only, no Tauri)
npm run tauri:dev           # Tauri dev (desktop app with hot reload)
npm run tauri:build         # Production build
npm run check               # Type-check (svelte-kit sync + svelte-check)
npm run build               # Vite build (frontend only)
npm run test                # Vitest (scanner library)
npm run analyze             # CLI scanner (console output)
npm run analyze:json        # CLI scanner (JSON output)
cargo build                 # Rust build (from src-tauri/)
cargo check                 # Rust type-check (from src-tauri/)
```
