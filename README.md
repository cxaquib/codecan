# Codecan

[![Build](https://github.com/cxaquib/codecan/actions/workflows/build.yml/badge.svg)](https://github.com/cxaquib/codecan/actions/workflows/build.yml)
[![Downloads](https://img.shields.io/github/downloads/cxaquib/codecan/total?color=brightgreen)](https://github.com/cxaquib/codecan/releases/latest)
[![Visitors](https://visitor-badge.laobi.icu/badge?page_id=cxaquib.codecan&left_text=visitors)](https://github.com/cxaquib/codecan)
[![Latest Release](https://img.shields.io/github/v/release/cxaquib/codecan?label=release&color=blue)](https://github.com/cxaquib/codecan/releases/latest)

Cut the clutter. Keep the logic.

Codecan is a desktop code scanning application built with Tauri v2 + SvelteKit 5. It scans source code repositories for quality issues — duplicate code, unused imports, redundant patterns, architecture violations, and dependency risks — with optional AI-powered analysis using local or cloud models.

## Features

- **Rule-based scanning** — Static analysis for 11 file types (JS, TS, Svelte, Rust, CSS, HTML, JSON, TOML). Detects duplicate CSS rules, unused imports, redundant code patterns, component architecture violations, and dependency issues (deprecated/malicious npm packages, unpinned versions, typosquatting).
- **AI-powered scanning** — Analyze code with local GGUF models (via llama.cpp) or cloud models (OpenRouter, Hugging Face). 9 models available including Llama 3.3 70B, Gemma 4, Qwen2.5-Coder, StarCoder2.
- **Batch AI processing** — All files sent in a single IPC call with progress events streaming to the UI. No freezing.
- **Multi-source API key management** — Keys from env vars, config files (`.codecan.json`), and UI input. Auto-discovery walks up directory tree.
- **Dark mode** — Respects system preference, toggleable.
- **CLI mode** — Run scans from the terminal via `npm run analyze`.
- **Cross-platform** — Tauri v2 desktop app (Linux, macOS, Windows).

## Quick Start

### Download and run (no install)

```bash
curl -LO https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_amd64.deb
sudo dpkg -i Codecan_0.1.0_amd64.deb
codecan
```

Or run the binary directly:

```bash
# Download and run without installing
chmod +x Codecan
./Codecan
```

### Build from source

```bash
npm install
npm run tauri:dev
```

## Usage

### Desktop App

```bash
npm run tauri:dev       # Development mode (hot reload)
npm run tauri:build     # Production build
./scripts/rebuild-deb.sh  # Fix .deb after build (Tauri bundler bug workaround)
sudo dpkg -i src-tauri/target/release/bundle/deb/Codecan_0.1.0_amd64.deb  # Install .deb
```

1. Launch the app
2. Select a folder or file to scan
3. Click **Scan** for rule-based analysis, or **Scan with AI** for AI-powered analysis
4. View results grouped by category with severity badges and code snippets

### Downloads

Pre-built installers for all platforms on the [Releases page](https://github.com/cxaquib/codecan/releases/latest). Tap/copy any link to share:

```text
https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_amd64.deb
https://github.com/cxaquib/codecan/releases/latest/download/Codecan-0.1.0-1.x86_64.rpm
https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_x64.msi
https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_x64.dmg
```

| Platform | Format | Download |
|----------|--------|----------|
| Linux | `.deb` | [Codecan_0.1.0_amd64.deb](https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_amd64.deb) |
| Linux | `.rpm` | [Codecan-0.1.0-1.x86_64.rpm](https://github.com/cxaquib/codecan/releases/latest/download/Codecan-0.1.0-1.x86_64.rpm) |
| Windows | `.msi` | [Codecan_0.1.0_x64.msi](https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_x64.msi) |
| macOS | `.dmg` | [Codecan_0.1.0_x64.dmg](https://github.com/cxaquib/codecan/releases/latest/download/Codecan_0.1.0_x64.dmg) |

> Download counts and visitor stats are shown in the badges at the top of this page. Counts update automatically from GitHub.

To trigger a new build, push a tag:

```bash
git tag v0.1.0 && git push --tags
```

Or trigger manually from the Actions tab. The CI builds all platforms and creates a release automatically.

### CLI

```bash
npm run analyze            # Scan current directory (console output)
npm run analyze:json       # Scan current directory (JSON output)
npx tsx src/index.ts scan /path/to/project  # Scan specific path
```

## Documentation

Full architecture reference with every file, command, data flow, and design decision:

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (browser only) |
| `npm run tauri:dev` | Tauri desktop app dev mode |
| `npm run tauri:build` | Production Tauri bundle |  
| `./scripts/rebuild-deb.sh` | Fix corrupt .deb after `tauri build` |
| `npm run check` | Type-check (svelte-check) |
| `npm run build` | Frontend build only |
| `npm run test` | Run scanner tests (Vitest) |
| `npm run analyze` | CLI scanner (console output) |
| `npm run analyze:json` | CLI scanner (JSON output) |

All cargo commands run from the `src-tauri/` directory:

| Cargo Command | Description |
|---------------|-------------|
| `cargo tauri dev` | Run desktop app in development mode (hot reload) |
| `cargo tauri build` | Build production desktop app bundle |
| `cargo build` | Build Rust backend only |
| `cargo check` | Type-check Rust backend |
| `cargo test` | Run Rust tests |
| `cargo clippy` | Lint Rust code |
| `cargo fmt` | Format Rust code |

## Tech Stack

- **Desktop**: Tauri v2
- **Frontend**: SvelteKit 5, TypeScript, Tailwind CSS v4
- **Backend**: Rust (ureq, llama-cpp-2, tokio, serde)
- **Testing**: Vitest
- **AI**: OpenRouter API, Hugging Face Inference API, llama.cpp (local GGUF)

## License

MIT
