use crate::file_io::{load_project, save_project};
use crate::generator::{generate_c, generate_python, generate_rust};
use crate::parser::validate_schema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolIR {
    pub version: String,
    pub messages: Vec<ProtocolMessage>,
    pub structs: Vec<ProtocolStruct>,
    pub enums: Vec<ProtocolEnum>,
    pub fields: Vec<ProtocolField>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolMessage {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolStruct {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolEnum {
    pub id: String,
    pub name: String,
    pub values: std::collections::HashMap<String, i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolField {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub length: Option<u32>,
    pub default_value: Option<String>,
    pub optional: Option<bool>,
    pub comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolProject {
    pub name: String,
    pub ir: ProtocolIR,
}

#[tauri::command]
pub fn save_protocol(project: ProtocolProject, path: String) -> Result<(), String> {
    save_project(&project, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_protocol(path: String) -> Result<ProtocolProject, String> {
    load_project(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_code(ir: ProtocolIR, language: String) -> Result<String, String> {
    match language.as_str() {
        "c" => Ok(generate_c(&ir)),
        "python" => Ok(generate_python(&ir)),
        "rust" => Ok(generate_rust(&ir)),
        _ => Err(format!("Unsupported language: {}", language)),
    }
}

#[tauri::command]
pub fn validate_protocol(ir: ProtocolIR) -> Result<Vec<String>, String> {
    validate_schema(&ir).map_err(|e| e.to_string())
}
