use crate::commands::ProtocolIR;

pub fn generate_c(ir: &ProtocolIR) -> String {
    let mut output = String::new();
    output.push_str("#include <stdint.h>\n#include <stdbool.h>\n#include <string.h>\n\n");

    for en in &ir.enums {
        output.push_str(&format!("typedef enum {{\n"));
        let entries: Vec<_> = en.values.iter().collect();
        for (i, (key, val)) in entries.iter().enumerate() {
            output.push_str(&format!("    {} = {}", key, val));
            if i < entries.len() - 1 {
                output.push(',');
            }
            output.push('\n');
        }
        output.push_str(&format!("}} {};\n\n", en.name));
    }

    for st in &ir.structs {
        output.push_str(&format!("typedef struct {{\n"));
        for field_id in &st.fields {
            if let Some(field) = ir.fields.iter().find(|f| &f.id == field_id) {
                let c_type = map_c_type(&field.r#type);
                output.push_str(&format!("    {} {}", c_type, field.name));
                if let Some(len) = field.length {
                    if field.r#type != "string" {
                        output.push_str(&format!("[{}]", len));
                    }
                }
                output.push_str(";\n");
            }
        }
        output.push_str(&format!("}} {};\n\n", st.name));
    }

    for msg in &ir.messages {
        output.push_str(&format!("typedef struct {{\n"));
        let fields: Vec<_> = msg.fields.iter()
            .filter_map(|fid| ir.fields.iter().find(|f| &f.id == fid))
            .collect();

        for field in &fields {
            let c_type = map_c_type(&field.r#type);
            output.push_str(&format!("    {} {}", c_type, field.name));
            if let Some(len) = field.length {
                if field.r#type != "string" {
                    output.push_str(&format!("[{}]", len));
                }
            }
            output.push_str(";\n");
        }
        output.push_str(&format!("}} {};\n\n", msg.name));

        // Encode function
        output.push_str(&format!("int encode_{}(uint8_t* buf, {}* msg) {{\n", msg.name, msg.name));
        output.push_str("    int offset = 0;\n");
        for field in &fields {
            output.push_str(&generate_encode_field(field));
        }
        output.push_str("    return offset;\n}\n\n");

        // Decode function
        output.push_str(&format!("int decode_{}(uint8_t* buf, {}* msg) {{\n", msg.name, msg.name));
        output.push_str("    int offset = 0;\n");
        for field in &fields {
            output.push_str(&generate_decode_field(field));
        }
        output.push_str("    return offset;\n}\n\n");
    }

    output
}

fn map_c_type(ty: &str) -> String {
    match ty {
        "uint8" => "uint8_t".to_string(),
        "int8" => "int8_t".to_string(),
        "uint16" => "uint16_t".to_string(),
        "int16" => "int16_t".to_string(),
        "uint32" => "uint32_t".to_string(),
        "int32" => "int32_t".to_string(),
        "uint64" => "uint64_t".to_string(),
        "int64" => "int64_t".to_string(),
        "float" => "float".to_string(),
        "double" => "double".to_string(),
        "bool" => "bool".to_string(),
        "char" => "char".to_string(),
        "string" => "char*".to_string(),
        "bytes" => "uint8_t*".to_string(),
        _ => "void*".to_string(),
    }
}

fn get_type_size(ty: &str) -> Option<&str> {
    match ty {
        "uint8" | "int8" | "bool" | "char" => Some("1"),
        "uint16" | "int16" => Some("2"),
        "uint32" | "int32" | "float" => Some("4"),
        "uint64" | "int64" | "double" => Some("8"),
        _ => None,
    }
}

fn generate_encode_field(field: &crate::commands::ProtocolField) -> String {
    let name = &field.name;
    if let Some(size) = get_type_size(&field.r#type) {
        format!("    memcpy(buf + offset, &msg->{}, {});\n", name, size)
    } else if field.r#type == "string" {
        let len = field.length.unwrap_or(256);
        format!("    strncpy(buf + offset, msg->{}, {});\n", name, len)
    } else {
        format!("    // TODO: encode {} {}\n", field.r#type, name)
    }
}

fn generate_decode_field(field: &crate::commands::ProtocolField) -> String {
    let name = &field.name;
    if let Some(size) = get_type_size(&field.r#type) {
        format!("    memcpy(&msg->{}, buf + offset, {});\n", name, size)
    } else if field.r#type == "string" {
        let len = field.length.unwrap_or(256);
        format!("    strncpy(msg->{}, buf + offset, {});\n", name, len)
    } else {
        format!("    // TODO: decode {} {}\n", field.r#type, name)
    }
}

pub fn generate_python(ir: &ProtocolIR) -> String {
    let mut output = String::new();
    output.push_str("import struct\n\n");

    for en in &ir.enums {
        output.push_str(&format!("class {}:\n", en.name));
        for (key, val) in &en.values {
            output.push_str(&format!("    {} = {}\n", key, val));
        }
        output.push('\n');
    }

    for msg in &ir.messages {
        let fields: Vec<_> = msg.fields.iter()
            .filter_map(|fid| ir.fields.iter().find(|f| &f.id == fid))
            .collect();

        output.push_str(&format!("class {}:\n", msg.name));
        output.push_str("    def __init__(self):\n");
        for field in &fields {
            match field.r#type.as_str() {
                "float" | "double" => output.push_str(&format!("        self.{} = 0.0\n", field.name)),
                "string" => output.push_str(&format!("        self.{} = \"\"\n", field.name)),
                _ => output.push_str(&format!("        self.{} = 0\n", field.name)),
            }
        }
        output.push('\n');

        let fmt: String = fields.iter().map(|f| map_python_fmt(&f.r#type)).collect();
        let field_names: Vec<_> = fields.iter().map(|f| format!("self.{}", f.name)).collect();

        output.push_str(&format!("    def encode(self) -> bytes:\n"));
        output.push_str(&format!("        return struct.pack(\"{}\"", fmt));
        for name in &field_names {
            output.push_str(&format!(", {}", name));
        }
        output.push_str(")\n\n");

        output.push_str("    @classmethod\n");
        output.push_str(&format!("    def decode(cls, data: bytes) -> \"{}\":\n", msg.name));
        output.push_str("        msg = cls()\n");
        output.push_str(&format!("        values = struct.unpack(\"{}\", data)\n", fmt));
        for (i, field) in fields.iter().enumerate() {
            output.push_str(&format!("        msg.{} = values[{}]\n", field.name, i));
        }
        output.push_str("        return msg\n\n");
    }

    output
}

fn map_python_fmt(ty: &str) -> char {
    match ty {
        "uint8" => 'B',
        "int8" => 'b',
        "uint16" => 'H',
        "int16" => 'h',
        "uint32" => 'I',
        "int32" => 'i',
        "uint64" => 'Q',
        "int64" => 'q',
        "float" => 'f',
        "double" => 'd',
        "bool" => '?',
        _ => 'x',
    }
}

pub fn generate_rust(ir: &ProtocolIR) -> String {
    let mut output = String::new();
    output.push_str("use serde::{Deserialize, Serialize};\n\n");

    for en in &ir.enums {
        output.push_str("#[derive(Debug, Clone, Copy, Serialize, Deserialize)]\n");
        output.push_str(&format!("pub enum {} {{\n", en.name));
        for (key, val) in &en.values {
            output.push_str(&format!("    {} = {},\n", key, val));
        }
        output.push_str("}\n\n");
    }

    for st in &ir.structs {
        output.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        output.push_str(&format!("pub struct {} {{\n", st.name));
        for field_id in &st.fields {
            if let Some(field) = ir.fields.iter().find(|f| &f.id == field_id) {
                let rust_type = map_rust_type(&field.r#type);
                output.push_str(&format!("    pub {}: {},\n", field.name, rust_type));
            }
        }
        output.push_str("}\n\n");
    }

    for msg in &ir.messages {
        output.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        output.push_str(&format!("pub struct {} {{\n", msg.name));
        for field_id in &msg.fields {
            if let Some(field) = ir.fields.iter().find(|f| &f.id == field_id) {
                let rust_type = map_rust_type(&field.r#type);
                output.push_str(&format!("    pub {}: {},\n", field.name, rust_type));
            }
        }
        output.push_str("}\n\n");
    }

    output
}

fn map_rust_type(ty: &str) -> String {
    match ty {
        "uint8" => "u8".to_string(),
        "int8" => "i8".to_string(),
        "uint16" => "u16".to_string(),
        "int16" => "i16".to_string(),
        "uint32" => "u32".to_string(),
        "int32" => "i32".to_string(),
        "uint64" => "u64".to_string(),
        "int64" => "i64".to_string(),
        "float" => "f32".to_string(),
        "double" => "f64".to_string(),
        "bool" => "bool".to_string(),
        "string" => "String".to_string(),
        "bytes" => "Vec<u8>".to_string(),
        _ => "Vec<u8>".to_string(),
    }
}
