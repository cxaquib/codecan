use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

const MODEL_FILE: &str = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf";

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();

fn get_backend() -> Result<&'static LlamaBackend, String> {
    if let Some(backend) = BACKEND.get() {
        return Ok(backend);
    }
    let backend = LlamaBackend::init().map_err(|e| format!("Failed to init backend: {}", e))?;
    BACKEND
        .set(backend)
        .map_err(|_| "Backend already initialized".to_string())?;
    Ok(BACKEND.get().unwrap())
}

pub struct LocalModel {
    pub path: PathBuf,
}

impl LocalModel {
    pub fn new(app_data_dir: &PathBuf) -> Self {
        Self {
            path: app_data_dir.join(MODEL_FILE),
        }
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn file_size_mb(&self) -> u64 {
        std::fs::metadata(&self.path)
            .map(|m| m.len() / 1_048_576)
            .unwrap_or(0)
    }

    pub fn download(&self) -> Result<String, String> {
        if self.exists() {
            return Ok(self.path.to_string_lossy().to_string());
        }

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create model directory: {}", e))?;
        }

        let resp = ureq::get(MODEL_URL)
            .set("User-Agent", "Codecan/0.1.0")
            .call()
            .map_err(|e| format!("Failed to start download: {}", e))?;

        let total = resp
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        let mut file = std::fs::File::create(&self.path)
            .map_err(|e| format!("Failed to create file: {}", e))?;

        let mut reader = resp.into_reader();
        let mut downloaded: u64 = 0;
        let mut buffer = [0u8; 8192];

        loop {
            use std::io::Read;
            let n = reader
                .read(&mut buffer)
                .map_err(|e| format!("Download error: {}", e))?;
            if n == 0 {
                break;
            }
            use std::io::Write;
            file.write_all(&buffer[..n])
                .map_err(|e| format!("Write error: {}", e))?;
            downloaded += n as u64;
            if total > 0 {
                let pct = (downloaded as f64 / total as f64) * 100.0;
                if pct as u64 % 10 == 0 {
                    println!("Downloaded: {}%", pct as u64);
                }
            }
        }

        Ok(self.path.to_string_lossy().to_string())
    }

    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<(String, usize), String> {
        let backend = get_backend()?;
        let model = load_model(backend, &self.path)?;
        run_inference(&model, backend, prompt, max_tokens)
    }

    pub fn generate_batch(
        &self,
        prompts: &[String],
        max_tokens: u32,
    ) -> Result<Vec<(String, usize)>, String> {
        let backend = get_backend()?;
        let model = load_model(backend, &self.path)?;
        prompts
            .iter()
            .map(|p| run_inference(&model, backend, p, max_tokens))
            .collect()
    }
}

fn load_model<'a>(backend: &'a LlamaBackend, path: &Path) -> Result<LlamaModel, String> {
    LlamaModel::load_from_file(backend, path, &LlamaModelParams::default())
        .map_err(|e| format!("Failed to load model: {}", e))
}

fn run_inference(
    model: &LlamaModel,
    backend: &LlamaBackend,
    prompt: &str,
    max_tokens: u32,
) -> Result<(String, usize), String> {
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(2048))
        .with_n_batch(512);

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {}", e))?;

    let chat_prompt = format!(
        "<|im_start|>system\nYou are a code review assistant. Analyze source code and report issues.\n<|im_end|>\n<|im_start|>user\n{}\n<|im_end|>\n<|im_start|>assistant\n",
        prompt
    );

    let tokens = model
        .str_to_token(&chat_prompt, AddBos::Always)
        .map_err(|e| format!("Tokenization failed: {}", e))?;

    if tokens.len() > 1800 {
        return Err(format!(
            "Prompt too long ({} tokens). Reduce the number of files scanned.",
            tokens.len()
        ));
    }

    let mut decoded = String::new();
    let mut decoder = UTF_8.new_decoder();
    let mut n_ctx = tokens.len();

    let mut batch = LlamaBatch::new(tokens.len(), 1);
    for (i, &token) in tokens.iter().enumerate() {
        batch
            .add(token, i as i32, &[0], true)
            .map_err(|e| format!("Batch add error: {}", e))?;
    }
    ctx.decode(&mut batch)
        .map_err(|e| format!("Decode error: {}", e))?;

    for _ in 0..max_tokens {
        let mut sampler = LlamaSampler::greedy();
        let new_token = sampler.sample(&ctx, 0);

        if model.is_eog_token(new_token) {
            break;
        }

        let piece = model
            .token_to_piece(new_token, &mut decoder, false, None)
            .unwrap_or_default();
        decoded.push_str(&piece);

        if decoded.len() > 4096 {
            break;
        }

        let mut next_batch = LlamaBatch::new(1, 1);
        next_batch
            .add(new_token, n_ctx as i32, &[0], true)
            .map_err(|e| format!("Batch add error: {}", e))?;
        n_ctx += 1;

        ctx.decode(&mut next_batch)
            .map_err(|e| format!("Decode error: {}", e))?;
    }

    Ok((decoded, tokens.len()))
}
