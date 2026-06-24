# Code Analysis Scanner - Implementation

## Overview

A code analysis tool that scans codebases for redundant code, duplicate code, and unused code.

## Features

### Implemented ✓
- **Duplicate Code Detection** - CSS selectors defined multiple times in same context
- **File Discovery** - Recursive directory scanning with extension filtering
- **Rust-based Scanner** - Native Rust implementation for performance

### UI Integration
The Scanner is integrated into the Tauri app:
- Click "Scan This Project" to analyze the current codebase
- Click "Browse..." to select a different project folder
- Results displayed in the UI with severity labels and code snippets

## Architecture

### Backend (Rust)
- `scan_code(directory)` - Scans a directory for code issues
- `pick_folder()` - Opens system folder picker dialog (using `rfd` crate)

### Frontend (Svelte)
- Directory input field with "Browse..." button
- "Scan Code" and "Scan This Project" buttons
- Results panel with color-coded severity badges

## Usage

### Command Line
```bash
npm run analyze      # Console output
npm run analyze:json # JSON output
```

### In the App
1. Launch the app (`npm run tauri:dev`)
2. Click "Scan This Project" or "Browse..." to select a folder
3. View results in the panel below

## File Structure

```
src/
  routes/+page.svelte  # Main UI with scanner controls
src/lib/scanner/       # TypeScript scanner (alternative implementation)
src-tauri/src/
  lib.rs              # Rust backend with scan_code and pick_folder commands
src-tauri/Cargo.toml  # Dependencies: tauri, rfd
```