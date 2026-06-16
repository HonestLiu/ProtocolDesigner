use crate::commands::ProtocolProject;
use std::fs;
use std::path::Path;

pub fn save_project(project: &ProtocolProject, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_string_pretty(project)?;
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)?;
    Ok(())
}

pub fn load_project(path: &str) -> Result<ProtocolProject, Box<dyn std::error::Error>> {
    let data = fs::read_to_string(path)?;
    let project: ProtocolProject = serde_json::from_str(&data)?;
    Ok(project)
}
