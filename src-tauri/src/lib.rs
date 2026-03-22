mod abort_manager;
mod android_monitor;
mod api;
mod app;
mod chat_appearance;
mod chat_manager;
mod content_filter;
mod creation_helper;
mod discovery;
mod dynamic_memory_run_manager;
mod embedding_model;
mod engine;
mod error;
mod group_chat_manager;
mod hf_browser;
mod image_generator;
mod llama_cpp;
mod logger;
pub mod migrations;
pub mod models;
mod pricing_cache;
mod providers;
mod serde_utils;
pub mod storage_manager;
pub mod sync;
mod tokenizer;
mod transport;
mod tts_manager;
mod usage;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
