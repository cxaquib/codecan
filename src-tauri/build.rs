fn main() {
    let key: Option<String> = std::env::var("CODECAN_FALLBACK_KEY")
        .ok()
        .filter(|k| !k.is_empty());
    let key = key.or_else(|| {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.codecan.json");
        let content = std::fs::read_to_string(&path).ok()?;
        let json: serde_json::Value = serde_json::from_str(&content).ok()?;
        let keys = json.get("apiKeys")?.as_array()?;
        for entry in keys {
            let name = entry.get("name")?.as_str()?;
            let val = entry.get("key")?.as_str()?;
            if name.contains("OpenRouter") || name.contains("openrouter") {
                return Some(val.to_string());
            }
        }
        None
    });
    if let Some(k) = &key {
        println!("cargo:rustc-env=CODECAN_FALLBACK_KEY={}", k);
    }

    tauri_build::build()
}
