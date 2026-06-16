use crate::file_io::{load_project, save_project};
use crate::generator::{generate_c, generate_python, generate_rust};
use crate::parser::validate_schema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolModules {
    pub header: bool,
    pub struct_types: bool,
    pub enum_types: bool,
    pub crc: bool,
    pub optional_fields: bool,
    pub range_checks: bool,
    pub validation: bool,
    pub tlv: bool,
    pub version_field: bool,
    pub forward_compat: bool,
    pub bitfields: bool,
    pub unions: bool,
    pub endian_control: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolIR {
    pub version: String,
    pub level: u8,
    pub modules: ProtocolModules,
    pub endian: String,
    pub messages: Vec<ProtocolMessage>,
    pub structs: Vec<ProtocolStruct>,
    pub enums: Vec<ProtocolEnum>,
    pub fields: Vec<ProtocolField>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolMessage {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolStruct {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolEnum {
    pub id: String,
    pub name: String,
    pub values: std::collections::HashMap<String, i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolField {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub length: Option<u32>,
    pub default_value: Option<String>,
    pub optional: Option<bool>,
    pub comment: Option<String>,
    pub enum_values: Option<std::collections::HashMap<String, i64>>,
    pub struct_ref: Option<String>,
    pub field_tag: Option<u32>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub bit_offset: Option<u32>,
    pub bit_width: Option<u32>,
    pub union_discriminant: Option<u32>,
    pub endian: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProtocolProject {
    pub name: String,
    pub ir: ProtocolIR,
    pub nodes: Option<serde_json::Value>,
    pub edges: Option<serde_json::Value>,
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
