use crate::commands::ProtocolIR;

fn find_enum_for_field<'a>(field_name: &str, field_type: &str, ir: &'a ProtocolIR) -> Option<&'a crate::commands::ProtocolEnum> {
    if field_type != "enum" || ir.enums.is_empty() {
        return None;
    }
    for en in &ir.enums {
        if field_name.to_lowercase().contains(&en.name.to_lowercase()) {
            return Some(en);
        }
    }
    Some(&ir.enums[0])
}

fn enum_wire_size(en: &crate::commands::ProtocolEnum) -> usize {
    let max_val = en.values.values().copied().max().unwrap_or(0);
    if max_val <= 0xFF { 1 } else if max_val <= 0xFFFF { 2 } else { 4 }
}

fn field_wire_size(field: &crate::commands::ProtocolField, ir: &ProtocolIR) -> usize {
    if let Some(en) = find_enum_for_field(&field.name, &field.r#type, ir) {
        return enum_wire_size(en);
    }
    match field.r#type.as_str() {
        "uint8" | "int8" | "bool" | "char" => 1,
        "uint16" | "int16" => 2,
        "uint32" | "int32" | "float" => 4,
        "uint64" | "int64" | "double" => 8,
        "string" => field.length.unwrap_or(256) as usize,
        "bytes" | "array" => field.length.unwrap_or(1) as usize,
        _ => 1,
    }
}

fn total_size(fields: &[&crate::commands::ProtocolField], ir: &ProtocolIR) -> usize {
    fields.iter().map(|f| field_wire_size(f, ir)).sum()
}

fn c_type(field: &crate::commands::ProtocolField, ir: &ProtocolIR) -> String {
    if let Some(en) = find_enum_for_field(&field.name, &field.r#type, ir) {
        return en.name.clone();
    }
    match field.r#type.as_str() {
        "uint8" => "uint8_t", "int8" => "int8_t",
        "uint16" => "uint16_t", "int16" => "int16_t",
        "uint32" => "uint32_t", "int32" => "int32_t",
        "uint64" => "uint64_t", "int64" => "int64_t",
        "float" => "float", "double" => "double",
        "bool" => "uint8_t", "char" => "char",
        "string" => "char", "bytes" | "array" | "struct" => "uint8_t",
        _ => "uint8_t",
    }.to_string()
}

fn field_c_def(field: &crate::commands::ProtocolField, ir: &ProtocolIR) -> String {
    let base = c_type(field, ir);
    match field.r#type.as_str() {
        "string" => format!("{} {}[{}]", base, field.name, field.length.unwrap_or(256)),
        "bytes" | "array" => format!("uint8_t {}[{}]", field.name, field.length.unwrap_or(1)),
        _ => format!("{} {}", base, field.name),
    }
}

fn encode_field_c(field: &crate::commands::ProtocolField, ir: &ProtocolIR) -> String {
    let sz = field_wire_size(field, ir);
    let nm = &field.name;

    if let Some(_en) = find_enum_for_field(nm, &field.r#type, ir) {
        if sz == 1 {
            return format!("    buf[offset] = (uint8_t)msg->{};\n    offset += {};\n", nm, sz);
        }
        return format!("    {{ uint{}_t tmp = (uint{}_t)msg->{};\n", sz * 8, sz * 8, nm)
            + &format!("      for (int i = 0; i < {}; i++) buf[offset + i] = (uint8_t)(tmp >> (i * 8));\n", sz)
            + &format!("    }}\n    offset += {};\n", sz);
    }

    match field.r#type.as_str() {
        "uint16" => format!("    buf[offset]     = (uint8_t)(msg->{} & 0xFF);\n    buf[offset + 1] = (uint8_t)((msg->{} >> 8) & 0xFF);\n    offset += {};\n", nm, nm, sz),
        "int16" => format!("    {{ uint16_t tmp = (uint16_t)msg->{}; memcpy(&buf[offset], &tmp, 2); }}\n    offset += {};\n", nm, sz),
        "uint32" => format!("    buf[offset]     = (uint8_t)(msg->{} & 0xFF);\n    buf[offset + 1] = (uint8_t)((msg->{} >> 8) & 0xFF);\n    buf[offset + 2] = (uint8_t)((msg->{} >> 16) & 0xFF);\n    buf[offset + 3] = (uint8_t)((msg->{} >> 24) & 0xFF);\n    offset += {};\n", nm, nm, nm, nm, sz),
        "int32" => format!("    {{ uint32_t tmp = (uint32_t)msg->{}; memcpy(&buf[offset], &tmp, 4); }}\n    offset += {};\n", nm, sz),
        "uint64" => format!("    {{ uint64_t v = msg->{}; for (int i = 0; i < 8; i++) buf[offset + i] = (uint8_t)(v >> (i * 8)); }}\n    offset += {};\n", nm, sz),
        "int64" => format!("    {{ uint64_t v = (uint64_t)msg->{}; for (int i = 0; i < 8; i++) buf[offset + i] = (uint8_t)(v >> (i * 8)); }}\n    offset += {};\n", nm, sz),
        "float" => format!("    {{ uint32_t tmp; memcpy(&tmp, &msg->{}, 4);\n      buf[offset]     = (uint8_t)(tmp & 0xFF);\n      buf[offset + 1] = (uint8_t)((tmp >> 8) & 0xFF);\n      buf[offset + 2] = (uint8_t)((tmp >> 16) & 0xFF);\n      buf[offset + 3] = (uint8_t)((tmp >> 24) & 0xFF); }}\n    offset += {};\n", nm, sz),
        "double" => format!("    {{ uint64_t tmp; memcpy(&tmp, &msg->{}, 8);\n      for (int i = 0; i < 8; i++) buf[offset + i] = (uint8_t)(tmp >> (i * 8)); }}\n    offset += {};\n", nm, sz),
        "bool" => format!("    buf[offset] = msg->{} ? 1 : 0;\n    offset += 1;\n", nm),
        "string" => format!("    memcpy(buf + offset, msg->{}, {});\n    buf[offset + {} - 1] = '\\0';\n    offset += {};\n", nm, sz, sz, sz),
        "bytes" | "array" => format!("    memcpy(buf + offset, msg->{}, {});\n    offset += {};\n", nm, sz, sz),
        _ => format!("    buf[offset] = (uint8_t)msg->{};\n    offset += 1;\n", nm),
    }
}

fn decode_field_c(field: &crate::commands::ProtocolField, ir: &ProtocolIR) -> String {
    let sz = field_wire_size(field, ir);
    let nm = &field.name;

    if let Some(en) = find_enum_for_field(nm, &field.r#type, ir) {
        if sz == 1 {
            return format!("    msg->{} = ({})buf[offset];\n    offset += {};\n", nm, en.name, sz);
        }
        return format!("    {{ uint{}_t tmp = 0;\n", sz * 8)
            + &format!("      for (int i = 0; i < {}; i++) tmp |= ((uint{}_t)buf[offset + i]) << (i * 8);\n", sz, sz * 8)
            + &format!("      memcpy(&msg->{}, &tmp, {}); }}\n", nm, sz)
            + &format!("    offset += {};\n", sz);
    }

    match field.r#type.as_str() {
        "uint16" => format!("    msg->{} = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);\n    offset += {};\n", nm, sz),
        "int16" => format!("    {{ uint16_t tmp = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8); memcpy(&msg->{}, &tmp, 2); }}\n    offset += {};\n", nm, sz),
        "uint32" => format!("    msg->{} = (uint32_t)buf[offset] | ((uint32_t)buf[offset + 1] << 8) |\n              ((uint32_t)buf[offset + 2] << 16) | ((uint32_t)buf[offset + 3] << 24);\n    offset += {};\n", nm, sz),
        "int32" => format!("    {{ uint32_t tmp = (uint32_t)buf[offset] | ((uint32_t)buf[offset + 1] << 8) |\n                   ((uint32_t)buf[offset + 2] << 16) | ((uint32_t)buf[offset + 3] << 24);\n      memcpy(&msg->{}, &tmp, 4); }}\n    offset += {};\n", nm, sz),
        "uint64" => format!("    msg->{} = 0;\n    for (int i = 0; i < 8; i++) msg->{} |= ((uint64_t)buf[offset + i]) << (i * 8);\n    offset += {};\n", nm, nm, sz),
        "int64" => format!("    {{ uint64_t tmp = 0;\n      for (int i = 0; i < 8; i++) tmp |= ((uint64_t)buf[offset + i]) << (i * 8);\n      memcpy(&msg->{}, &tmp, 8); }}\n    offset += {};\n", nm, sz),
        "float" => format!("    {{ uint32_t tmp = (uint32_t)buf[offset] | ((uint32_t)buf[offset + 1] << 8) |\n                   ((uint32_t)buf[offset + 2] << 16) | ((uint32_t)buf[offset + 3] << 24);\n      memcpy(&msg->{}, &tmp, 4); }}\n    offset += {};\n", nm, sz),
        "double" => format!("    {{ uint64_t tmp = 0;\n      for (int i = 0; i < 8; i++) tmp |= ((uint64_t)buf[offset + i]) << (i * 8);\n      memcpy(&msg->{}, &tmp, 8); }}\n    offset += {};\n", nm, sz),
        "bool" => format!("    msg->{} = buf[offset] ? 1 : 0;\n    offset += 1;\n", nm),
        "string" => format!("    memcpy(msg->{}, buf + offset, {});\n    msg->{}[{} - 1] = '\\0';\n    offset += {};\n", nm, sz, nm, sz, sz),
        "bytes" | "array" => format!("    memcpy(msg->{}, buf + offset, {});\n    offset += {};\n", nm, sz, sz),
        _ => format!("    msg->{} = buf[offset];\n    offset += 1;\n", nm),
    }
}

pub fn generate_c(ir: &ProtocolIR) -> String {
    let mut out = String::new();
    out.push_str("#include <stdint.h>\n#include <string.h>\n\n");

    for en in &ir.enums {
        out.push_str("typedef enum {\n");
        let entries: Vec<_> = en.values.iter().collect();
        for (i, (key, val)) in entries.iter().enumerate() {
            out.push_str(&format!("    {}_{} = {}", en.name, key, val));
            if i < entries.len() - 1 { out.push(','); }
            out.push('\n');
        }
        out.push_str(&format!("}} {};\n\n", en.name));
    }

    let fields_for = |ids: &[String]| -> Vec<&crate::commands::ProtocolField> {
        ids.iter().filter_map(|fid| ir.fields.iter().find(|f| f.id == *fid)).collect()
    };

    for st in &ir.structs {
        let fields = fields_for(&st.fields);
        out.push_str("typedef struct __attribute__((packed)) {\n");
        for f in &fields { out.push_str(&format!("    {};\n", field_c_def(f, ir))); }
        out.push_str(&format!("}} {};\n\n", st.name));
    }
    for msg in &ir.messages {
        let fields = fields_for(&msg.fields);
        out.push_str("typedef struct __attribute__((packed)) {\n");
        for f in &fields { out.push_str(&format!("    {};\n", field_c_def(f, ir))); }
        out.push_str(&format!("}} {};\n\n", msg.name));
    }

    let build_fn = |name: &str, field_ids: &[String]| -> String {
        let fields = fields_for(field_ids);
        let sz = total_size(&fields, ir);
        let mut s = format!("int encode_{}(uint8_t *buf, size_t buf_len, const {} *msg) {{\n", name, name);
        s.push_str(&format!("    if (buf_len < {}) return -1;\n", sz));
        s.push_str("    int offset = 0;\n");
        for f in &fields { s.push_str(&encode_field_c(f, ir)); }
        s.push_str("    return offset;\n}\n\n");

        s.push_str(&format!("int decode_{}(const uint8_t *buf, size_t buf_len, {} *msg) {{\n", name, name));
        s.push_str(&format!("    if (buf_len < {}) return -1;\n", sz));
        s.push_str("    int offset = 0;\n");
        for f in &fields { s.push_str(&decode_field_c(f, ir)); }
        s.push_str("    return offset;\n}\n\n");
        s.push_str(&format!("int {}_size(void) {{ return {}; }}\n\n", name, sz));
        s
    };

    for st in &ir.structs { out.push_str(&build_fn(&st.name, &st.fields)); }
    for msg in &ir.messages { out.push_str(&build_fn(&msg.name, &msg.fields)); }
    out
}

pub fn generate_python(ir: &ProtocolIR) -> String {
    let mut out = String::new();
    out.push_str("import struct\n\n");

    for en in &ir.enums {
        out.push_str(&format!("class {}:\n", en.name));
        for (key, val) in &en.values {
            out.push_str(&format!("    {} = {}\n", key, val));
        }
        out.push('\n');
    }

    let fmt_map = |ty: &str| -> char {
        match ty { "uint8" => 'B', "int8" => 'b', "uint16" => 'H', "int16" => 'h', "uint32" => 'I', "int32" => 'i', "uint64" => 'Q', "int64" => 'q', "float" => 'f', "double" => 'd', "bool" => '?', "enum" => 'B', _ => 'x' }
    };

    let build = |name: &str, field_ids: &[String]| -> String {
        let fields: Vec<_> = field_ids.iter().filter_map(|fid| ir.fields.iter().find(|f| f.id == *fid)).collect();
        let mut s = format!("class {}:\n", name);
        s.push_str("    def __init__(self):\n");
        for f in &fields {
            match f.r#type.as_str() {
                "float" | "double" => s.push_str(&format!("        self.{} = 0.0\n", f.name)),
                "bool" => s.push_str(&format!("        self.{} = False\n", f.name)),
                "string" => s.push_str(&format!("        self.{} = \"\"\n", f.name)),
                "bytes" | "array" => s.push_str(&format!("        self.{} = b'\\x00' * {}\n", f.name, f.length.unwrap_or(1))),
                "enum" => {
                    if let Some(en) = find_enum_for_field(&f.name, &f.r#type, ir) {
                        if let Some(first) = en.values.keys().next() {
                            s.push_str(&format!("        self.{} = {}.{}\n", f.name, en.name, first));
                        } else { s.push_str(&format!("        self.{} = 0\n", f.name)); }
                    } else { s.push_str(&format!("        self.{} = 0\n", f.name)); }
                }
                _ => s.push_str(&format!("        self.{} = 0\n", f.name)),
            }
        }
        s.push('\n');

        let fmt: String = fields.iter().map(|f| fmt_map(&f.r#type)).collect();
        let names: Vec<_> = fields.iter().map(|f| format!("self.{}", f.name)).collect();
        let sz: usize = fields.iter().map(|f| field_wire_size(f, ir)).sum();

        s.push_str("    def encode(self) -> bytes:\n");
        s.push_str(&format!("        return struct.pack(\"<{}\" {})\n", fmt, names.join(", ")));
        s.push_str("\n    @classmethod\n");
        s.push_str(&format!("    def decode(cls, data: bytes) -> \"{}\":\n", name));
        s.push_str(&format!("        if len(data) < {}.size():\n", name));
        s.push_str(&format!("            raise ValueError(f\"Buffer too small: {{len(data)}} < {}.size()\")\n", name));
        s.push_str("        msg = cls()\n");
        s.push_str(&format!("        values = struct.unpack(\"<{}\", data)\n", fmt));
        for (i, f) in fields.iter().enumerate() {
            s.push_str(&format!("        msg.{} = values[{}]\n", f.name, i));
        }
        s.push_str("        return msg\n\n");
        s.push_str(&format!("    @staticmethod\n    def size() -> int:\n        return {}\n\n", sz));
        s
    };

    for st in &ir.structs { out.push_str(&build(&st.name, &st.fields)); }
    for msg in &ir.messages { out.push_str(&build(&msg.name, &msg.fields)); }
    out
}

fn rust_type(ty: &str) -> String {
    match ty {
        "uint8" => "u8", "int8" => "i8", "uint16" => "u16", "int16" => "i16",
        "uint32" => "u32", "int32" => "i32", "uint64" => "u64", "int64" => "i64",
        "float" => "f32", "double" => "f64", "bool" => "bool",
        "string" => "String", "bytes" | "array" => "Vec<u8>",
        _ => "Vec<u8>",
    }.to_string()
}

pub fn generate_rust(ir: &ProtocolIR) -> String {
    let mut out = String::new();
    out.push_str("use serde::{Deserialize, Serialize};\nuse std::io;\n\n");

    for en in &ir.enums {
        out.push_str("#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\n#[repr(u8)]\npub enum ");
        out.push_str(&format!("{} {{\n", en.name));
        for (key, val) in &en.values {
            out.push_str(&format!("    #[serde(rename = \"{}\")]\n    {} = {},\n", key, key, val));
        }
        out.push_str("}\n\n");
        out.push_str(&format!("impl {} {{\n    pub fn from_u8(v: u8) -> Option<Self> {{\n        match v {{\n", en.name));
        for (key, val) in &en.values {
            out.push_str(&format!("            {} => Some({}::{}),\n", val, en.name, key));
        }
        out.push_str("            _ => None,\n        }\n    }\n}\n\n");
    }

    let build = |name: &str, field_ids: &[String]| -> String {
        let fields: Vec<_> = field_ids.iter().filter_map(|fid| ir.fields.iter().find(|f| f.id == *fid)).collect();
        let mut s = String::new();
        s.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ");
        s.push_str(&format!("{} {{\n", name));
        for f in &fields {
            if f.r#type == "enum" {
                if let Some(en) = find_enum_for_field(&f.name, &f.r#type, ir) {
                    s.push_str(&format!("    pub {}: {},\n", f.name, en.name));
                } else {
                    s.push_str(&format!("    pub {}: u8,\n", f.name));
                }
            } else {
                s.push_str(&format!("    pub {}: {},\n", f.name, rust_type(&f.r#type)));
            }
        }
        s.push_str("}\n\n");

        let sz: usize = fields.iter().map(|f| field_wire_size(f, ir)).sum();
        s.push_str(&format!("impl {} {{\n    pub const fn serialized_size() -> usize {{ {} }}\n\n", name, sz));

        s.push_str("    pub fn encode(&self, buf: &mut Vec<u8>) {\n");
        s.push_str("        buf.reserve(Self::serialized_size());\n");
        for f in &fields {
            if f.r#type == "enum" {
                s.push_str(&format!("        buf.push(self.{} as u8);\n", f.name));
            } else if f.r#type == "float" {
                s.push_str(&format!("        buf.extend_from_slice(&self.{}.to_le_bytes());\n", f.name));
            } else if f.r#type == "double" {
                s.push_str(&format!("        buf.extend_from_slice(&self.{}.to_le_bytes());\n", f.name));
            } else if f.r#type == "bool" {
                s.push_str(&format!("        buf.push(if self.{} {{ 1 }} else {{ 0 }});\n", f.name));
            } else if f.r#type == "string" {
                let ws = field_wire_size(f, ir);
                s.push_str(&format!("        let bytes = self.{}.as_bytes();\n", f.name));
                s.push_str(&format!("        let mut padded = [0u8; {}];\n", ws));
                s.push_str(&format!("        let len = bytes.len().min({});\n", ws));
                s.push_str("        padded[..len].copy_from_slice(&bytes[..len]);\n");
                s.push_str("        buf.extend_from_slice(&padded);\n");
            } else if f.r#type == "bytes" || f.r#type == "array" {
                let ws = field_wire_size(f, ir);
                s.push_str(&format!("        let mut padded = [0u8; {}];\n", ws));
                s.push_str(&format!("        let len = self.{}.len().min({});\n", f.name, ws));
                s.push_str(&format!("        padded[..len].copy_from_slice(&self.{}[..len]);\n", f.name));
                s.push_str("        buf.extend_from_slice(&padded);\n");
            } else {
                s.push_str(&format!("        buf.extend_from_slice(&(self.{} as {}).to_le_bytes());\n", f.name, rust_type(&f.r#type)));
            }
        }
        s.push_str("    }\n\n");

        s.push_str("    pub fn decode(buf: &[u8]) -> io::Result<Self> {\n");
        s.push_str("        if buf.len() < Self::serialized_size() {\n");
        s.push_str("            return Err(io::Error::new(io::ErrorKind::InvalidData, \"buffer too small\"));\n");
        s.push_str("        }\n        let mut pos = 0;\n");
        for f in &fields {
            let ws = field_wire_size(f, ir);
            if f.r#type == "enum" {
                if let Some(en) = find_enum_for_field(&f.name, &f.r#type, ir) {
                    s.push_str(&format!("        let {} = {}::from_u8(buf[pos]).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, \"invalid {} value\"))?;\n", f.name, en.name, en.name));
                } else {
                    s.push_str(&format!("        let {} = buf[pos];\n", f.name));
                }
                s.push_str(&format!("        pos += {};\n", ws));
            } else if f.r#type == "float" {
                s.push_str(&format!("        let {} = f32::from_le_bytes(buf[pos..pos + {}].try_into().unwrap());\n", f.name, ws));
                s.push_str(&format!("        pos += {};\n", ws));
            } else if f.r#type == "double" {
                s.push_str(&format!("        let {} = f64::from_le_bytes(buf[pos..pos + {}].try_into().unwrap());\n", f.name, ws));
                s.push_str(&format!("        pos += {};\n", ws));
            } else if f.r#type == "bool" {
                s.push_str(&format!("        let {} = buf[pos] != 0;\n", f.name));
                s.push_str("        pos += 1;\n");
            } else if f.r#type == "string" {
                s.push_str(&format!("        let {} = String::from_utf8_lossy(&buf[pos..pos + {}]).trim_end_matches('\\0').to_string();\n", f.name, ws));
                s.push_str(&format!("        pos += {};\n", ws));
            } else if f.r#type == "bytes" || f.r#type == "array" {
                s.push_str(&format!("        let {} = buf[pos..pos + {}].to_vec();\n", f.name, ws));
                s.push_str(&format!("        pos += {};\n", ws));
            } else if ws == 1 {
                s.push_str(&format!("        let {} = buf[pos];\n", f.name));
                s.push_str("        pos += 1;\n");
            } else {
                s.push_str(&format!("        let {} = {}::from_le_bytes(buf[pos..pos + {}].try_into().unwrap());\n", f.name, rust_type(&f.r#type), ws));
                s.push_str(&format!("        pos += {};\n", ws));
            }
        }
        let names: Vec<_> = fields.iter().map(|f| f.name.clone()).collect();
        s.push_str(&format!("        Ok(Self {{ {} }})\n", names.join(", ")));
        s.push_str("    }\n}\n\n");
        s
    };

    for st in &ir.structs { out.push_str(&build(&st.name, &st.fields)); }
    for msg in &ir.messages { out.push_str(&build(&msg.name, &msg.fields)); }
    out
}
