use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

mod local_llm;

struct LocalModelState {
    model: Mutex<local_llm::LocalModel>,
}

struct CancellationState {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(serde::Serialize)]
struct ScanResult {
    file: String,
    r#type: String,
    severity: String,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    code_snippet: Option<String>,
    suggestion: Option<String>,
}

#[tauri::command]
async fn scan_code(
    path: Option<String>,
    scan_id: String,
    cancel_state: tauri::State<'_, CancellationState>,
) -> Result<String, String> {
    let target = path.unwrap_or_else(|| ".".to_string());
    if !Path::new(&target).exists() {
        return Err(format!("Path '{}' does not exist", target));
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = cancel_state.flags.lock().map_err(|e| e.to_string())?;
        flags.insert(scan_id.clone(), cancel_flag.clone());
    }

    let inner_target = target.clone();
    let inner_flag = cancel_flag.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut results: Vec<ScanResult> = Vec::new();
        let target_path = Path::new(&inner_target);
        if target_path.is_file() {
            scan_single_file(target_path, &mut results).ok();
        } else {
            scan_directory(&inner_target, &mut results, &inner_flag).ok();
        }
        serde_json::to_string(&results)
    })
    .await
    .map_err(|e| format!("Scan task panicked: {}", e))?
    .map_err(|e| e.to_string())?;

    {
        let mut flags = cancel_state.flags.lock().map_err(|e| e.to_string())?;
        flags.remove(&scan_id);
    }

    if cancel_flag.load(Ordering::SeqCst) && result == "[]" {
        return Ok(String::new());
    }

    Ok(result)
}

fn scan_single_file(path: &Path, results: &mut Vec<ScanResult>) -> io::Result<()> {
    let ext = path.extension().and_then(|e| e.to_str());
    match ext {
        Some("svelte") | Some("css") => {
            let content = fs::read_to_string(path)?;
            let css_content = extract_style_content(&content);
            check_file_size(&content, &path.to_string_lossy(), results);
            find_duplicate_css_rules(&css_content, &path.to_string_lossy(), results);
            find_redundant_code(&content, &path.to_string_lossy(), results);
            if ext == Some("svelte") {
                check_component_architecture(&content, &path.to_string_lossy(), results);
            }
        }
        Some("js") | Some("ts") | Some("jsx") | Some("tsx") | Some("mjs") => {
            let content = fs::read_to_string(path)?;
            check_file_size(&content, &path.to_string_lossy(), results);
            find_unused_js_imports(&content, &path.to_string_lossy(), results);
            find_redundant_code(&content, &path.to_string_lossy(), results);
        }
        Some("rs") => {
            let content = fs::read_to_string(path)?;
            check_file_size(&content, &path.to_string_lossy(), results);
            find_unused_rust_imports(&content, &path.to_string_lossy(), results);
            find_redundant_code(&content, &path.to_string_lossy(), results);
        }
        Some("html") => {
            let content = fs::read_to_string(path)?;
            let css_content = extract_style_content(&content);
            check_file_size(&content, &path.to_string_lossy(), results);
            find_duplicate_css_rules(&css_content, &path.to_string_lossy(), results);
            find_redundant_code(&content, &path.to_string_lossy(), results);
        }
        Some("json") => {
            let content = fs::read_to_string(path)?;
            check_file_size(&content, &path.to_string_lossy(), results);
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == "package.json" {
                check_npm_dependencies(&content, &path.to_string_lossy(), results);
            }
        }
        Some("toml") => {
            let content = fs::read_to_string(path)?;
            check_file_size(&content, &path.to_string_lossy(), results);
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == "Cargo.toml" {
                check_cargo_dependencies(&content, &path.to_string_lossy(), results);
            }
        }
        _ => {}
    }
    Ok(())
}

fn check_file_size(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let line_count = content.lines().count();
    let byte_size = content.len();
    let name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let (line_warn, line_error) = match ext {
        "svelte" => (200, 400),
        "ts" | "js" | "tsx" | "jsx" | "rs" => (300, 600),
        "css" => (400, 800),
        _ => return,
    };

    if line_count > line_warn {
        let severity = if line_count > line_error {
            "warning"
        } else {
            "info"
        };
        results.push(ScanResult {
            file: file_path.to_string(),
            r#type: "architecture".to_string(),
            severity: severity.to_string(),
            message: format!(
                "File \"{}\" has {} lines (threshold: {}). Consider splitting into smaller files.",
                name, line_count, line_warn
            ),
            line: Some(line_count),
            column: None,
            code_snippet: None,
            suggestion: None,
        });
    }

    let size_warn = match ext {
        "svelte" => 10 * 1024,
        "ts" | "js" | "tsx" | "jsx" | "rs" => 20 * 1024,
        "css" => 30 * 1024,
        _ => return,
    };

    if byte_size > size_warn * 3 {
        let size_kb = byte_size as f64 / 1024.0;
        results.push(ScanResult {
            file: file_path.to_string(),
            r#type: "architecture".to_string(),
            severity: "warning".to_string(),
            message: format!(
                "File \"{}\" is {:.1}KB (threshold: {}KB). Unusually large.",
                name,
                size_kb,
                size_warn / 1024
            ),
            line: Some(line_count),
            column: None,
            code_snippet: None,
            suggestion: None,
        });
    }
}

const SOURCE_EXTENSIONS: &[&str] = &[
    "js", "ts", "jsx", "tsx", "mjs", "svelte", "rs", "css", "html", "json", "toml",
];
const MAX_FILE_SIZE: u64 = 1_048_576; // 1 MB

fn scan_directory(dir: &str, results: &mut Vec<ScanResult>, cancel: &AtomicBool) -> io::Result<()> {
    let path = Path::new(dir);

    for entry in fs::read_dir(path)? {
        if cancel.load(Ordering::SeqCst) {
            return Ok(());
        }

        let entry = entry?;
        let entry_path = entry.path();
        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if entry_path.is_dir() {
            if !name.starts_with(".")
                && !["node_modules", "target", "dist", "build"].contains(&name)
            {
                scan_directory(&entry_path.to_string_lossy(), results, cancel)?;
            }
        } else if entry_path.is_file() {
            if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if SOURCE_EXTENSIONS.contains(&ext) {
                    if let Ok(meta) = entry_path.metadata() {
                        if meta.len() > MAX_FILE_SIZE {
                            continue;
                        }
                    }
                    scan_single_file(&entry_path, results)?;
                }
            }
        }
    }

    Ok(())
}

fn extract_style_content(content: &str) -> String {
    if let Some(start) = content.find("<style") {
        if let Some(end) = content[start..].find("</style>") {
            let end = start + end;
            return content[start..end].to_string();
        }
    }
    content.to_string()
}

fn find_duplicate_css_rules(css: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let mut rule_counts: HashMap<String, usize> = HashMap::new();
    let mut brace_depth = 0;
    let mut in_media_query = false;

    for line in css.lines() {
        let trimmed = line.trim();
        brace_depth += trimmed.matches('{').count();
        brace_depth -= trimmed.matches('}').count();

        if trimmed.starts_with("@media") || trimmed.starts_with("@supports") {
            in_media_query = true;
        }
        if brace_depth == 0 {
            in_media_query = false;
        }
        if in_media_query {
            continue;
        }

        if let Some(selector_end) = trimmed.find('{') {
            let selector = trimmed[..selector_end].trim();
            if !selector.is_empty() {
                *rule_counts.entry(selector.to_string()).or_insert(0) += 1;
            }
        }
    }

    for (selector, count) in rule_counts.iter() {
        if *count > 1 {
            results.push(ScanResult {
                file: file_path.to_string(),
                r#type: "duplicate".to_string(),
                severity: "warning".to_string(),
                message: format!("CSS rule '{}' is defined {} times", selector, count),
                line: Some(1),
                column: None,
                code_snippet: Some(format!("{} {{ ... }}", selector)),
                suggestion: None,
            });
        }
    }
}

fn find_unused_js_imports(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut used_identifiers: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in &lines {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") {
            continue;
        }
        for word in trimmed.split(|c: char| !c.is_alphanumeric() && c != '_') {
            if !word.is_empty()
                && word
                    .chars()
                    .next()
                    .map_or(false, |c| c.is_alphabetic() || c == '_')
            {
                used_identifiers.insert(word.to_string());
            }
        }
    }

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(brace_start) = trimmed.find('{') {
            if let Some(brace_end) = trimmed.find('}') {
                let before_brace = &trimmed[..brace_start];
                if before_brace.trim() == "import" || before_brace.trim().ends_with("import") {
                    // Extract source: find the part after "from"
                    let after_brace = &trimmed[brace_end + 1..];
                    let source = if let Some(from_pos) = after_brace.find("from") {
                        let after_from = after_brace[from_pos + 4..].trim();
                        after_from.trim_matches('\'').trim_matches('"')
                    } else {
                        "unknown"
                    };

                    let names_str = &trimmed[brace_start + 1..brace_end];
                    for name in names_str
                        .split(',')
                        .map(|n| n.trim())
                        .filter(|n| !n.is_empty())
                    {
                        if !used_identifiers.contains(name) {
                            results.push(ScanResult {
                                file: file_path.to_string(),
                                r#type: "unused".to_string(),
                                severity: "warning".to_string(),
                                message: format!(
                                    "Imported \"{}\" from \"{}\" is never used",
                                    name, source
                                ),
                                line: Some(i + 1),
                                column: None,
                                code_snippet: Some(line.to_string()),
                                suggestion: None,
                            });
                        }
                    }
                }
            }
        }
    }
}

fn find_redundant_code(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let lines: Vec<&str> = content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Deep nesting check (> 32 spaces indent / 16+ levels)
        let indent = line.len() - trimmed.len();
        if indent > 32 {
            results.push(ScanResult {
                file: file_path.to_string(),
                r#type: "redundant".to_string(),
                severity: "warning".to_string(),
                message: "Code has deeply nested structure (16+ levels at 2-space indent)"
                    .to_string(),
                line: Some(i + 1),
                column: None,
                code_snippet: Some(trimmed.chars().take(80).collect()),
                suggestion: None,
            });
        }

        // Overly long parameter list check
        if trimmed.contains("fn ") || trimmed.starts_with("function ") {
            let param_count = trimmed.matches(',').count() + 1;
            if param_count > 8 {
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "redundant".to_string(),
                    severity: "info".to_string(),
                    message: format!(
                        "Function has {} parameters, consider refactoring",
                        param_count
                    ),
                    line: Some(i + 1),
                    column: None,
                    code_snippet: Some(trimmed.chars().take(80).collect()),
                    suggestion: None,
                });
            }
        }

        // Duplicate variable declaration (same name assigned on consecutive lines)
        if i + 1 < lines.len() {
            let next_trimmed = lines[i + 1].trim();
            if let Some(var) = extract_var_name(trimmed) {
                if let Some(next_var) = extract_var_name(next_trimmed) {
                    if var == next_var && var.len() > 2 {
                        results.push(ScanResult {
                            file: file_path.to_string(),
                            r#type: "redundant".to_string(),
                            severity: "info".to_string(),
                            message: format!("Variable \"{}\" is declared multiple times", var),
                            line: Some(i + 1),
                            column: None,
                            code_snippet: Some(format!("{} / {}", trimmed, next_trimmed)),
                            suggestion: None,
                        });
                    }
                }
            }
        }
    }
}

fn extract_var_name(line: &str) -> Option<&str> {
    let keywords = ["let ", "const ", "var ", "let\t", "const\t", "var\t"];
    for kw in &keywords {
        if let Some(rest) = line.strip_prefix(kw) {
            if let Some(eq_pos) = rest.find('=') {
                let name = rest[..eq_pos].trim();
                if name.contains(' ') || name.contains('\t') {
                    return None; // destructuring
                }
                return Some(name);
            } else if rest.ends_with(';') {
                let name = rest[..rest.len() - 1].trim();
                if !name.contains(' ') && !name.contains('\t') {
                    return Some(name);
                }
            }
        }
    }
    None
}

fn find_unused_rust_imports(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut used_identifiers: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in &lines {
        let trimmed = line.trim();
        if trimmed.starts_with("use ") {
            continue;
        }
        for word in trimmed.split(|c: char| !c.is_alphanumeric() && c != '_') {
            if !word.is_empty()
                && word
                    .chars()
                    .next()
                    .map_or(false, |c| c.is_alphabetic() || c == '_')
            {
                used_identifiers.insert(word.to_string());
            }
        }
    }

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("use ") && trimmed.ends_with(';') {
            let import_body = &trimmed[4..trimmed.len() - 1].trim();
            let segments: Vec<&str> = import_body.split("::").collect();
            let item_name = segments.last().unwrap_or(&"");
            if !item_name.is_empty() && !used_identifiers.contains(*item_name) {
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "unused".to_string(),
                    severity: "warning".to_string(),
                    message: format!("Imported \"{}\" appears to be unused", import_body),
                    line: Some(i + 1),
                    column: None,
                    code_snippet: Some(line.to_string()),
                    suggestion: None,
                });
            }
        }
    }
}

fn check_component_architecture(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let path_lower = file_path.to_lowercase();
    let name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    let dumb_paths = ["/components/", "/ui/", "/atoms/"];
    let dumb_names = [
        "button",
        "card",
        "input",
        "modal",
        "badge",
        "icon",
        "avatar",
        "tag",
        "chip",
        "dropdown",
        "tooltip",
        "popover",
        "accordion",
        "tabs",
        "breadcrumb",
        "pagination",
        "spinner",
        "skeleton",
        "alert",
        "toast",
        "drawer",
        "label",
        "select",
        "checkbox",
        "radio",
        "switch",
        "slider",
        "progress",
        "divider",
        "list",
        "table",
        "menu",
        "navbar",
        "footer",
        "heading",
        "text",
        "link",
        "image",
        "video",
        "collapse",
        "carousel",
        "rating",
        "timeline",
        "search",
        "sidebar",
        "overlay",
    ];

    let is_dumb_path = dumb_paths.iter().any(|p| path_lower.contains(p));
    let file_stem = name.trim_end_matches(".svelte");
    let is_dumb_name = dumb_names
        .iter()
        .any(|n| file_stem == *n || file_stem.starts_with(n));
    let is_page =
        path_lower.contains("/routes/") || name.starts_with("+page") || name.starts_with("+layout");

    if (is_dumb_path || is_dumb_name) && !is_page {
        let indicators: Vec<(&str, &str, &str)> = vec![
            ("$state(", "warning", "uses $state (state management)"),
            ("$derived(", "info", "uses $derived (derived state)"),
            ("$effect(", "info", "uses $effect (side effects)"),
            ("onMount(", "info", "uses onMount lifecycle hook"),
            ("onDestroy(", "info", "uses onDestroy lifecycle hook"),
            ("invoke(", "warning", "calls invoke (data fetching)"),
            ("writable(", "warning", "creates a writable store"),
            ("readable(", "warning", "creates a readable store"),
        ];

        for (pat, severity, msg) in indicators {
            if let Some(idx) = content.find(pat) {
                let line_num = content[..idx].matches('\n').count() + 1;
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "architecture".to_string(),
                    severity: severity.to_string(),
                    message: format!(
                        "Presentational component \"{}\" {}. Consider extracting logic to a container.",
                        name, msg
                    ),
                    line: Some(line_num),
                    column: None,
                    code_snippet: content.lines().nth(line_num - 1).map(|l| l.trim().chars().take(80).collect()),
            suggestion: None,
                });
            }
        }
    }
}

fn check_npm_dependencies(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => {
            results.push(ScanResult {
                file: file_path.to_string(),
                r#type: "dependency".to_string(),
                severity: "error".to_string(),
                message: "package.json is not valid JSON".to_string(),
                line: None,
                column: None,
                code_snippet: None,
                suggestion: Some("Fix the JSON syntax in package.json.".to_string()),
            });
            return;
        }
    };

    let known_deprecated: HashMap<&str, &str> = [
        (
            "left-pad",
            "Use String.prototype.padStart() or a modern alternative",
        ),
        ("request", "Use node-fetch, axios, or got instead"),
        ("gulp-util", "Use individual gulp plugins instead"),
        ("bower", "Use npm, yarn, or pnpm instead"),
        ("jade", "Renamed to pug. Use pug instead."),
        ("node-uuid", "Use the uuid package instead"),
        ("moment", "Use date-fns, dayjs, or luxon instead"),
        (
            "faker",
            "Renamed to @faker-js/faker. Update your dependency.",
        ),
        ("colors", "Supply chain incident in 2022. Pin carefully."),
    ]
    .iter()
    .cloned()
    .collect();

    let known_malicious: HashMap<&str, &str> = [
        ("crossenv", "Typosquatting of cross-env. Do not install."),
        ("lodahs", "Typosquatting of lodash. Do not install."),
        ("reques", "Typosquatting of request. Do not install."),
    ]
    .iter()
    .cloned()
    .collect();

    let suspicious_scripts = ["preinstall", "postinstall", "preuninstall", "postuninstall"];

    let dep_sections = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ];
    for section in &dep_sections {
        if let Some(deps) = parsed.get(section).and_then(|v| v.as_object()) {
            for (name, version_val) in deps {
                let version = version_val.as_str().unwrap_or("*");

                if let Some(msg) = known_deprecated.get(name.as_str()) {
                    results.push(ScanResult {
                        file: file_path.to_string(),
                        r#type: "dependency".to_string(),
                        severity: "warning".to_string(),
                        message: format!("Deprecated package \"{}\" ({}): {}", name, version, msg),
                        line: None,
                        column: None,
                        code_snippet: None,
                        suggestion: Some(format!(
                            "Replace \"{}\" with the recommended alternative.",
                            name
                        )),
                    });
                }

                if let Some(msg) = known_malicious.get(name.as_str()) {
                    results.push(ScanResult {
                        file: file_path.to_string(),
                        r#type: "dependency".to_string(),
                        severity: "error".to_string(),
                        message: format!("Potentially malicious package \"{}\": {}", name, msg),
                        line: None,
                        column: None,
                        code_snippet: None,
                        suggestion: Some(format!(
                            "Remove \"{}\" immediately and verify your lockfile.",
                            name
                        )),
                    });
                }

                if version.starts_with('^') || version.starts_with('~') {
                    results.push(ScanResult {
                        file: file_path.to_string(),
                        r#type: "dependency".to_string(),
                        severity: "info".to_string(),
                        message: format!("Package \"{}\" has an unpinned version range \"{}\". Consider pinning.", name, version),
                        line: None,
                        column: None,
                        code_snippet: None,
                        suggestion: Some(format!("Replace \"{}\" with an exact version.", version)),
                    });
                }
            }
        }
    }

    if let Some(scripts) = parsed.get("scripts").and_then(|v| v.as_object()) {
        for script_name in scripts.keys() {
            if suspicious_scripts.contains(&script_name.as_str()) {
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "dependency".to_string(),
                    severity: "warning".to_string(),
                    message: format!("Package.json has a \"{}\" script hook. Install scripts are a common vector for supply-chain attacks.", script_name),
                    line: None,
                    column: None,
                    code_snippet: None,
                    suggestion: Some(format!("Remove the \"{}\" script unless absolutely necessary.", script_name)),
                });
            }
        }
    }
}

fn check_cargo_dependencies(content: &str, file_path: &str, results: &mut Vec<ScanResult>) {
    let known_deprecated_crates: HashMap<&str, &str> = [
        ("rustc-serialize", "Use serde instead"),
        ("advapi32-sys", "Use winapi or windows crate"),
        ("kernel32-sys", "Use winapi or windows crate"),
    ]
    .iter()
    .cloned()
    .collect();

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        if let Some(eq_pos) = trimmed.find('=') {
            let name = trimmed[..eq_pos].trim();
            if name.contains(' ') || name.starts_with('[') {
                continue;
            }
            let val = trimmed[eq_pos + 1..].trim();

            if val == "\"*\"" || val == "*" {
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "dependency".to_string(),
                    severity: "warning".to_string(),
                    message: format!(
                        "Crate \"{}\" uses a wildcard \"*\" version. Pin to a specific version.",
                        name
                    ),
                    line: Some(i + 1),
                    column: None,
                    code_snippet: Some(line.to_string()),
                    suggestion: Some(format!(
                        "Pin \"{}\" to a specific version like \"1.2.3\".",
                        name
                    )),
                });
            }

            if let Some(msg) = known_deprecated_crates.get(name) {
                results.push(ScanResult {
                    file: file_path.to_string(),
                    r#type: "dependency".to_string(),
                    severity: "warning".to_string(),
                    message: format!("Deprecated crate \"{}\": {}", name, msg),
                    line: Some(i + 1),
                    column: None,
                    code_snippet: Some(line.to_string()),
                    suggestion: Some(format!(
                        "Replace \"{}\" with the recommended alternative.",
                        name
                    )),
                });
            }
        }
    }
}

#[derive(serde::Serialize)]
struct FileContent {
    path: String,
    content: String,
    r#type: String,
}

fn get_file_type(ext: &str) -> &str {
    match ext {
        ".js" => "javascript",
        ".ts" => "typescript",
        ".svelte" => "svelte",
        ".rs" => "rust",
        ".css" => "css",
        ".html" => "html",
        ".json" => "json",
        ".toml" => "toml",
        _ => "unknown",
    }
}

fn walk_files(
    dir: &Path,
    files: &mut Vec<FileContent>,
    extensions: &[&str],
    exclude_dirs: &[&str],
    cancel: &AtomicBool,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        if cancel.load(Ordering::SeqCst) {
            return Ok(());
        }
        let entry = entry?;
        let entry_path = entry.path();
        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if entry_path.is_dir() {
            if !name.starts_with(".") && !exclude_dirs.contains(&name) {
                walk_files(&entry_path, files, extensions, exclude_dirs, cancel)?;
            }
        } else if entry_path.is_file() {
            if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                let ext_str = format!(".{}", ext);
                if extensions.contains(&ext_str.as_str()) || extensions.contains(&ext) {
                    if let Ok(content) = fs::read_to_string(&entry_path) {
                        files.push(FileContent {
                            path: entry_path.to_string_lossy().to_string(),
                            content,
                            r#type: get_file_type(&ext_str).to_string(),
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn read_files_for_ai(
    path: String,
    scan_id: String,
    cancel_state: tauri::State<'_, CancellationState>,
) -> Result<String, String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("Path '{}' does not exist", path));
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = cancel_state.flags.lock().map_err(|e| e.to_string())?;
        flags.insert(scan_id.clone(), cancel_flag.clone());
    }

    let extensions = [
        ".js", ".ts", ".svelte", ".rs", ".css", ".html", ".json", ".toml",
    ];
    let exclude_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".svelte-kit",
    ];

    let inner_path = target.to_path_buf();
    let inner_flag = cancel_flag.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut files: Vec<FileContent> = Vec::new();
        if inner_path.is_file() {
            if let Some(ext) = inner_path.extension().and_then(|e| e.to_str()) {
                let ext_str = format!(".{}", ext);
                if extensions.contains(&ext_str.as_str()) || extensions.contains(&ext) {
                    if let Ok(content) = fs::read_to_string(&inner_path) {
                        files.push(FileContent {
                            path: inner_path.to_string_lossy().to_string(),
                            content,
                            r#type: get_file_type(&ext_str).to_string(),
                        });
                    }
                }
            }
        } else {
            walk_files(&inner_path, &mut files, &extensions, &exclude_dirs, &inner_flag).ok();
        }
        serde_json::to_string(&files)
    })
    .await
    .map_err(|e| format!("File scan task panicked: {}", e))?
    .map_err(|e| e.to_string())?;

    {
        let mut flags = cancel_state.flags.lock().map_err(|e| e.to_string())?;
        flags.remove(&scan_id);
    }

    Ok(result)
}

#[tauri::command]
fn call_hf_api(
    prompt: String,
    endpoint: String,
    api_token: Option<String>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "inputs": prompt,
        "options": {
            "wait_for_model": true,
            "use_cache": false
        }
    });

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120))
        .build();

    let mut req = agent
        .post(&endpoint)
        .set("Content-Type", "application/json");

    if let Some(token) = &api_token {
        req = req.set("Authorization", &format!("Bearer {}", token));
    }

    match req.send_string(&body.to_string()) {
        Ok(response) => {
            let status = response.status();
            if status == 401 || status == 403 {
                return Err("AI scan requires a free Hugging Face API token.".to_string());
            }
            if status != 200 {
                return Err(format!(
                    "AI provider returned {}: {}",
                    status,
                    response.status_text()
                ));
            }
            response.into_string().map_err(|e| e.to_string())
        }
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            Err("AI scan requires a free Hugging Face API token.".to_string())
        }
        Err(ureq::Error::Status(code, response)) => {
            let text = response.into_string().unwrap_or_default();
            Err(format!("AI provider returned {}: {}", code, text))
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("timed out") || msg.contains("Timeout") {
                Err(
                    "AI analysis timed out (2 min). The model may be loading. Try again."
                        .to_string(),
                )
            } else {
                Err(format!(
                    "AI scan failed: {}. Falling back to rule-based results.",
                    msg
                ))
            }
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct OpenRouterMessage {
    role: String,
    content: String,
}

#[tauri::command]
fn call_openrouter_api(
    model: String,
    messages: Vec<OpenRouterMessage>,
    api_token: String,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": 512,
    });

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120))
        .build();

    eprintln!("[openrouter] sending model={}, body={}", model, body.to_string());

    let result = agent
        .post("https://openrouter.ai/api/v1/chat/completions")
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", api_token))
        .set("HTTP-Referer", "https://codecan.app")
        .set("X-Title", "Codecan")
        .send_string(&body.to_string());

    match result {
        Ok(response) => {
            let status = response.status();
            let body_text = response.into_string().map_err(|e| e.to_string())?;
            if status != 200 {
                eprintln!("[openrouter] error response: {}", body_text);
                return Err(format!("OpenRouter returned {}: {}", status, body_text));
            }
            let json: serde_json::Value =
                serde_json::from_str(&body_text).map_err(|e| format!("Failed to parse response: {}", e))?;
            let content = json["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();
            Ok(content)
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body_text = resp.into_string().unwrap_or_default();
            eprintln!("[openrouter] status={} body={}", code, body_text);
            if code == 401 || code == 403 {
                Err("OpenRouter requires a valid API key.".to_string())
            } else {
                Err(format!("OpenRouter returned {}: {}", code, body_text))
            }
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("timed out") || msg.contains("Timeout") {
                Err("OpenRouter request timed out (2 min). Try again.".to_string())
            } else {
                Err(format!("OpenRouter request failed: {}", msg))
            }
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct AiFileProgress {
    index: usize,
    total: usize,
    file: String,
    status: String,
    error: Option<String>,
    issues: usize,
}

#[derive(serde::Serialize)]
struct AiBatchResult {
    file: String,
    issues: Vec<ScanResult>,
    error: Option<String>,
}

#[derive(serde::Deserialize)]
struct BatchFileInput {
    path: String,
    prompt: String,
    user_prompt: String,
    system_prompt: String,
}

fn parse_ai_response(text: &str, default_path: &str) -> Vec<ScanResult> {
    let mut results = Vec::new();
    let categories = ["duplicate", "unused", "redundant", "architecture", "dependency"];
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("ISSUE|") { continue; }
        let parts: Vec<&str> = trimmed.split('|').collect();
        if parts.len() < 5 { continue; }
        let category = parts[1];
        let file = parts[2];
        let severity = parts[3];
        let rest = parts[4..].join("|");
        let (message, suggestion) = match rest.rfind('|') {
            Some(idx) => (rest[..idx].trim().to_string(), Some(rest[idx+1..].trim().to_string())),
            None => (rest.trim().to_string(), None),
        };
        if !categories.contains(&category) { continue; }
        let severity_map = match severity.to_lowercase().as_str() {
            "error" => "error",
            "warning" => "warning",
            _ => "info",
        };
        let resolved_file = if file.is_empty() { default_path } else { file };
        results.push(ScanResult {
            file: resolved_file.to_string(),
            r#type: category.to_string(),
            severity: severity_map.to_string(),
            message,
            line: None,
            column: None,
            code_snippet: None,
            suggestion,
        });
    }
    results
}

#[tauri::command]
async fn batch_ai_scan(
    files: Vec<BatchFileInput>,
    provider: String,
    model: String,
    api_token: String,
    endpoint: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<AiBatchResult>, String> {
    let results = tokio::task::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(30))
            .timeout_read(std::time::Duration::from_secs(120))
            .build();

        let mut results = Vec::new();
        let total = files.len();

        for (i, file) in files.iter().enumerate() {
            let _ = app.emit("ai-scan-progress", AiFileProgress {
                index: i + 1,
                total,
                file: file.path.clone(),
                status: "analyzing".to_string(),
                error: None,
                issues: 0,
            });

            let result = if provider == "openrouter" {
                let body = serde_json::json!({
                    "model": model,
                    "messages": [
                        {"role": "system", "content": file.system_prompt},
                        {"role": "user", "content": file.user_prompt},
                    ],
                    "max_tokens": 512,
                });
                match agent
                    .post("https://openrouter.ai/api/v1/chat/completions")
                    .set("Content-Type", "application/json")
                    .set("Authorization", &format!("Bearer {}", api_token))
                    .set("HTTP-Referer", "https://codecan.app")
                    .set("X-Title", "Codecan")
                    .send_string(&body.to_string())
                {
                    Ok(resp) => {
                        let body_text = resp.into_string().unwrap_or_default();
                        match serde_json::from_str::<serde_json::Value>(&body_text) {
                            Ok(json) => {
                                let content = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
                                let issues = parse_ai_response(&content, &file.path);
                                AiBatchResult { file: file.path.clone(), issues, error: None }
                            }
                            Err(e) => AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(format!("JSON parse: {}", e)) }
                        }
                    }
                    Err(ureq::Error::Status(code, resp)) => {
                        let body_text = resp.into_string().unwrap_or_default();
                        AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(format!("{}: {}", code, body_text)) }
                    }
                    Err(e) => {
                        AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(e.to_string()) }
                    }
                }
            } else {
                let ep = endpoint.as_deref().unwrap_or("");
                let body = serde_json::json!({
                    "inputs": file.prompt,
                    "options": { "wait_for_model": true, "use_cache": false },
                });
                let mut req = agent
                    .post(ep)
                    .set("Content-Type", "application/json");
                if !api_token.is_empty() {
                    req = req.set("Authorization", &format!("Bearer {}", api_token));
                }
                match req.send_string(&body.to_string()) {
                    Ok(resp) => {
                        let status = resp.status();
                        let body_text = resp.into_string().unwrap_or_default();
                        if status != 200 {
                            let error = if status == 401 || status == 403 {
                                "Invalid Hugging Face API key. Check your token.".to_string()
                            } else {
                                format!("{}: {}", status, body_text)
                            };
                            AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(error) }
                        } else {
                            let issues = parse_ai_response(&body_text, &file.path);
                            AiBatchResult { file: file.path.clone(), issues, error: None }
                        }
                    }
                    Err(ureq::Error::Status(code, resp)) => {
                        let body_text = resp.into_string().unwrap_or_default();
                        let error = if code == 401 || code == 403 {
                            "Invalid Hugging Face API key. Check your token.".to_string()
                        } else {
                            format!("{}: {}", code, body_text)
                        };
                        AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(error) }
                    }
                    Err(e) => {
                        AiBatchResult { file: file.path.clone(), issues: vec![], error: Some(e.to_string()) }
                    }
                }
            };

            let _ = app.emit("ai-scan-progress", AiFileProgress {
                index: i + 1,
                total,
                file: file.path.clone(),
                status: if result.error.is_some() { "error".to_string() } else { "done".to_string() },
                error: result.error.clone(),
                issues: result.issues.len(),
            });

            results.push(result);
        }

        results
    })
    .await
    .map_err(|e| format!("Batch scan panicked: {}", e))?;

    Ok(results)
}

fn make_predefined_key(name: &str, key: &str) -> serde_json::Value {
    let id = format!("env-{}", name.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' }).collect::<String>());
    serde_json::json!({"id": id, "name": name, "key": key, "predefined": true})
}

fn find_upwards(filename: &str) -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let candidate = dir.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn load_env_config() -> Vec<serde_json::Value> {
    let mut keys: Vec<serde_json::Value> = Vec::new();

    if let Ok(val) = std::env::var("HF_API_KEY") {
        if !val.is_empty() {
            keys.push(make_predefined_key("HF_API_KEY (env)", &val));
        }
    }
    if let Ok(val) = std::env::var("OPENROUTER_API_KEY") {
        if !val.is_empty() {
            keys.push(make_predefined_key("OPENROUTER_API_KEY (env)", &val));
        }
    }

    let config_paths = [
        std::env::var("CODECAN_CONFIG").ok().map(PathBuf::from),
        std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".codecan.json")),
        find_upwards(".codecan.json"),
    ];

    for path in config_paths.into_iter().flatten() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(file_keys) = json.get("apiKeys").and_then(|v| v.as_array()) {
                    for k in file_keys {
                        if let (Some(name), Some(key)) =
                            (k.get("name").and_then(|v| v.as_str()), k.get("key").and_then(|v| v.as_str()))
                        {
                            keys.push(make_predefined_key(name, key));
                        }
                    }
                }
            }
        }
    }

    keys
}

fn load_dir_config(dir: &str) -> Vec<serde_json::Value> {
    let path = Path::new(dir).join(".codecan.json");
    let mut keys = Vec::new();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(file_keys) = json.get("apiKeys").and_then(|v| v.as_array()) {
                for k in file_keys {
                    if let (Some(name), Some(key)) =
                        (k.get("name").and_then(|v| v.as_str()), k.get("key").and_then(|v| v.as_str()))
                    {
                        keys.push(make_predefined_key(name, key));
                    }
                }
            }
        }
    }
    keys
}

#[tauri::command]
fn get_env_api_keys() -> Result<String, String> {
    let keys = load_env_config();
    serde_json::to_string(&keys).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_dir_api_keys(directory: String) -> Result<String, String> {
    let keys = load_dir_config(&directory);
    serde_json::to_string(&keys).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_local_model_status(state: tauri::State<'_, LocalModelState>) -> Result<String, String> {
    let model = state.model.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "exists": model.exists(),
        "path": model.path.to_string_lossy(),
        "size_mb": model.file_size_mb(),
    })
    .to_string())
}

#[tauri::command]
fn ensure_local_model(state: tauri::State<'_, LocalModelState>) -> Result<String, String> {
    let model = state.model.lock().map_err(|e| e.to_string())?;
    model.download()
}

#[tauri::command]
async fn run_local_inference(
    prompt: String,
    state: tauri::State<'_, LocalModelState>,
) -> Result<String, String> {
    let model_path = {
        let model = state.model.lock().map_err(|e| e.to_string())?;
        if !model.exists() {
            return Err("Model not downloaded. Click 'Download Model' first.".to_string());
        }
        model.path.clone()
    };

    let local_model = local_llm::LocalModel { path: model_path };
    let (text, token_count) = tokio::task::spawn_blocking(move || local_model.generate(&prompt, 512))
        .await
        .map_err(|e| format!("Inference task failed: {}", e))??;
    Ok(serde_json::json!({"text": text, "token_count": token_count}).to_string())
}

#[tauri::command]
async fn run_local_inference_batch(
    prompts: Vec<String>,
    max_tokens: Option<u32>,
    state: tauri::State<'_, LocalModelState>,
) -> Result<String, String> {
    let model_path = {
        let model = state.model.lock().map_err(|e| e.to_string())?;
        if !model.exists() {
            return Err("Model not downloaded. Click 'Download Model' first.".to_string());
        }
        model.path.clone()
    };

    let mt = max_tokens.unwrap_or(512);
    let local_model = local_llm::LocalModel { path: model_path };
    let results = tokio::task::spawn_blocking(move || local_model.generate_batch(&prompts, mt))
        .await
        .map_err(|e| format!("Inference task failed: {}", e))??;
    let json: Vec<_> = results
        .into_iter()
        .map(|(text, token_count)| serde_json::json!({"text": text, "token_count": token_count}))
        .collect();
    serde_json::to_string(&json).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_scan(scan_id: String, state: tauri::State<'_, CancellationState>) -> Result<(), String> {
    let mut flags = state.flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&scan_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&app_data).ok();
            let local_model = local_llm::LocalModel::new(&app_data);
            app.manage(LocalModelState {
                model: Mutex::new(local_model),
            });
            app.manage(CancellationState {
                flags: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            scan_code,
            read_files_for_ai,
            call_hf_api,
            call_openrouter_api,
            batch_ai_scan,
            get_env_api_keys,
            get_dir_api_keys,
            get_local_model_status,
            ensure_local_model,
            run_local_inference,
            run_local_inference_batch,
            cancel_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
