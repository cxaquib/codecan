# Feature Documentation

This folder contains documentation for added features and implementation instructions.

## Available Features

- [Architecture Reference](./ARCHITECTURE.md) - Full project reference: all files, commands, data flows, design decisions (AI-friendly)
- [Code Analysis Scanner](./features/code-analyzer-plan.md) - Tool to detect redundant, duplicate, and unused code

## Structure

- **features/** - Documentation for each feature implementation
- **api/** - API documentation and integration guides
- **tutorials/** - Step-by-step implementation guides

## Code Analysis Scanner

### Usage

```bash
# Run analysis with console output (default)
npm run analyze

# Run analysis with JSON output (for CI/CD)
npm run analyze:json
```

### What it detects

- **Unused imports** - Imports that are never used in JavaScript/TypeScript/Rust files
- **Duplicate CSS rules** - CSS selectors defined multiple times in the same context
- **Duplicate Rust functions** - Functions with identical signatures appearing in multiple files
- **Redundant code patterns** - Deeply nested code structures

## Adding New Feature Documentation

1. Create a new markdown file in the appropriate subfolder
2. Include sections:
   - Feature Overview
   - Implementation Details
   - Usage Examples
   - Configuration Options
3. Update this README with a link to the new documentation

## Template for Feature Documentation

```markdown
# Feature Name

## Overview
Brief description of what this feature does.

## Implementation
Technical details of how the feature is implemented.

### Files Modified/Created
- `path/to/file.ext` - Description

### Dependencies
- List any dependencies required

## Usage
Examples of how to use the feature.

## Configuration
Any configuration options available.
```