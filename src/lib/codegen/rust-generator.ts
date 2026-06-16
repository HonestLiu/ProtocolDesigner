import type { ProtocolIR, ProtocolField, ProtocolModules, Endianness } from '@/types/protocol';
import {
  getFieldWireSize, totalSize, findEnumForField,
  resolveModules, getEndianFnSuffix, getEndianFromFnSuffix,
  isVarField, isFixedField, computeOptionalBitmaskSize,
  getHeaderSize, getHeaderLayout,
} from './shared';

// ── Rust Type Helper ──────────────────────────────────────────────────────

function rustType(field: ProtocolField): string {
  const map: Record<string, string> = {
    uint8: 'u8', int8: 'i8', uint16: 'u16', int16: 'i16',
    uint32: 'u32', int32: 'i32', uint64: 'u64', int64: 'i64',
    float: 'f32', double: 'f64', bool: 'bool',
    string: 'String', bytes: 'Vec<u8>', array: 'Vec<u8>',
    vstring: 'String', vbytes: 'Vec<u8>',
  };
  return map[field.type] || 'Vec<u8>';
}

// ── 1. Imports ────────────────────────────────────────────────────────────

function genRsImports(): string {
  return 'use serde::{Deserialize, Serialize};\nuse std::io;\n';
}

// ── 2. Constants ──────────────────────────────────────────────────────────

function genRsConstants(modules: ProtocolModules): string {
  const lines: string[] = [];
  const hdrSize = getHeaderSize(modules);
  lines.push('pub const PROTOCOL_MAGIC: u16 = 0xAA55;');
  lines.push('pub const PROTOCOL_VERSION: u8 = 1;');
  if (modules.header) {
    lines.push(`pub const PROTOCOL_HEADER_SIZE: usize = ${hdrSize};`);
  }
  if (modules.crc) {
    lines.push('pub const PROTOCOL_CRC_SIZE: usize = 2;');
  }
  return lines.join('\n') + '\n';
}

// ── 3. CRC Function ───────────────────────────────────────────────────────

function genRsCrcFunction(): string {
  return [
    'pub fn crc16(data: &[u8]) -> u16 {',
    '    let mut crc: u16 = 0xFFFF;',
    '    for &byte in data {',
    '        crc ^= (byte as u16) << 8;',
    '        for _ in 0..8 {',
    '            if crc & 0x8000 != 0 {',
    '                crc = (crc << 1) ^ 0x1021;',
    '            } else {',
    '                crc <<= 1;',
    '            }',
    '        }',
    '    }',
    '    crc',
    '}\n',
  ].join('\n');
}

// ── 4. MsgType Enum ───────────────────────────────────────────────────────

function genRsMsgTypeEnum(msgNames: string[]): string {
  const lines: string[] = [
    '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
    '#[repr(u8)]',
    'pub enum MsgType {',
  ];
  for (let i = 0; i < msgNames.length; i++) {
    lines.push(`    ${msgNames[i]} = ${i},`);
  }
  lines.push('}\n');
  return lines.join('\n');
}

// ── 5. MsgType Impl ───────────────────────────────────────────────────────

function genRsMsgTypeImpl(msgNames: string[]): string {
  const lines: string[] = [
    'impl MsgType {',
    '    pub fn from_u8(v: u8) -> Option<Self> {',
    '        match v {',
  ];
  for (let i = 0; i < msgNames.length; i++) {
    lines.push(`            ${i} => Some(MsgType::${msgNames[i]}),`);
  }
  lines.push('            _ => None,');
  lines.push('        }');
  lines.push('    }');
  lines.push('}\n');
  return lines.join('\n');
}

// ── 6. Header Struct ──────────────────────────────────────────────────────

function genRsHeaderStruct(modules: ProtocolModules): string {
  const layout = getHeaderLayout(modules);
  const lines: string[] = [
    '#[derive(Debug, Clone, Copy)]',
    'pub struct ProtocolHeader {',
  ];
  for (const entry of layout) {
    const [name, ty] = entry.split(':');
    lines.push(`    pub ${name}: ${ty},`);
  }
  lines.push('}\n');
  return lines.join('\n');
}

// ── 7. Header Impl ────────────────────────────────────────────────────────

function genRsHeaderImpl(modules: ProtocolModules, endian: Endianness): string {
  const layout = getHeaderLayout(modules);
  const hasVersion = layout.some((e) => e.startsWith('version'));
  const hasPayloadLen = layout.some((e) => e.startsWith('payload_len'));
  const eSuffix = getEndianFnSuffix(endian);
  const eFromSuffix = getEndianFromFnSuffix(endian);

  const lines: string[] = ['impl ProtocolHeader {'];

  // new()
  if (hasPayloadLen) {
    lines.push('    pub fn new(msg_type: u8, payload_len: u16) -> Self {');
    if (hasVersion) {
      lines.push('        Self { magic: PROTOCOL_MAGIC, version: PROTOCOL_VERSION, msg_type, payload_len }');
    } else {
      lines.push('        Self { magic: PROTOCOL_MAGIC, msg_type, payload_len }');
    }
    lines.push('    }');
  } else {
    lines.push('    pub fn new(msg_type: u8) -> Self {');
    lines.push('        Self { magic: PROTOCOL_MAGIC, msg_type }');
    lines.push('    }');
  }

  // encode()
  lines.push('');
  lines.push('    pub fn encode(&self, buf: &mut Vec<u8>) {');
  for (const entry of layout) {
    const [name] = entry.split(':');
    if (name === 'magic') {
      lines.push(`        buf.extend_from_slice(&self.magic.${eSuffix}());`);
    } else if (name === 'version') {
      lines.push('        buf.push(self.version);');
    } else if (name === 'msg_type') {
      lines.push('        buf.push(self.msg_type);');
    } else if (name === 'payload_len') {
      lines.push(`        buf.extend_from_slice(&self.payload_len.${eSuffix}());`);
    }
  }
  lines.push('    }');

  // decode()
  lines.push('');
  lines.push('    pub fn decode(buf: &[u8]) -> io::Result<Self> {');
  const hdrSize = getHeaderSize(modules);
  lines.push(`        if buf.len() < ${hdrSize} {`);
  lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, "buffer too small for header"));');
  lines.push('        }');
  lines.push(`        let magic = u16::${eFromSuffix}([buf[0], buf[1]]);`);
  lines.push('        if magic != PROTOCOL_MAGIC {');
  lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("bad magic: 0x{:04X}", magic)));');
  lines.push('        }');
  let offset = 2;
  if (hasVersion) {
    lines.push(`        let version = buf[${offset}];`);
    lines.push('        if version != PROTOCOL_VERSION {');
    lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("version mismatch: {} (expected {})", version, PROTOCOL_VERSION)));');
    lines.push('        }');
    offset += 1;
  }
  lines.push(`        let msg_type = buf[${offset}];`);
  offset += 1;
  if (hasPayloadLen) {
    lines.push(`        let payload_len = u16::${eFromSuffix}([buf[${offset}], buf[${offset + 1}]]);`);
  }
  // Build return
  if (hasVersion && hasPayloadLen) {
    lines.push('        Ok(Self { magic, version, msg_type, payload_len })');
  } else if (hasVersion) {
    lines.push('        Ok(Self { magic, version, msg_type })');
  } else if (hasPayloadLen) {
    lines.push('        Ok(Self { magic, msg_type, payload_len })');
  } else {
    lines.push('        Ok(Self { magic, msg_type })');
  }
  lines.push('    }');
  lines.push('}\n');
  return lines.join('\n');
}

// ── 8. User Enum ──────────────────────────────────────────────────────────

function genRsUserEnum(
  en: { name: string; values: Record<string, number> },
): string {
  const lines: string[] = [
    '#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]',
    '#[repr(u8)]',
    `pub enum ${en.name} {`,
  ];
  for (const [key] of Object.entries(en.values)) {
    lines.push(`    #[serde(rename = "${key}")]`);
    lines.push(`    ${key} = ${en.values[key]},`);
  }
  lines.push('}');
  lines.push('');
  lines.push(`impl ${en.name} {`);
  lines.push('    pub fn from_u8(v: u8) -> Option<Self> {');
  lines.push('        match v {');
  for (const [key, val] of Object.entries(en.values)) {
    lines.push(`            ${val} => Some(${en.name}::${key}),`);
  }
  lines.push('            _ => None,');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── 9. Field Definition (one line) ────────────────────────────────────────

function genRsFieldDef(field: ProtocolField, ir: ProtocolIR): string {
  if (field.type === 'enum') {
    const en = findEnumForField(field, ir);
    return `    pub ${field.name}: ${en ? en.name : 'u8'},`;
  }
  return `    pub ${field.name}: ${rustType(field)},`;
}

// ── 10. Struct Definition ─────────────────────────────────────────────────

function genRsStructDef(name: string, fields: ProtocolField[], ir: ProtocolIR): string {
  const lines: string[] = [
    '#[derive(Debug, Clone, Serialize, Deserialize)]',
    `pub struct ${name} {`,
  ];
  for (const f of fields) {
    lines.push(genRsFieldDef(f, ir));
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── 12. TLV Encode Body ───────────────────────────────────────────────────

function genRsTlvEncode(name: string, fields: ProtocolField[], ir: ProtocolIR): string {
  const lines: string[] = [
    '    pub fn encode_payload(&self, buf: &mut Vec<u8>) {',
  ];
  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    const tag = f.fieldTag ?? fi;
    const nm = f.name;

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`        let raw_bytes = self.${nm}.as_bytes();`);
      lines.push(`        let vlen = raw_bytes.len().min(${cap});`);
      lines.push(`        buf.push(${tag});`);
      lines.push(`        buf.extend_from_slice(&((vlen + 2) as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&(vlen as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&raw_bytes[..vlen]);`);
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`        let vlen = self.${nm}.len().min(${cap});`);
      lines.push(`        buf.push(${tag});`);
      lines.push(`        buf.extend_from_slice(&((vlen + 2) as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&(vlen as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&self.${nm}[..vlen]);`);
    } else {
      const ws = getFieldWireSize(f, ir);
      lines.push(`        buf.push(${tag});`);
      lines.push(`        buf.extend_from_slice(&(${ws} as u16).to_le_bytes());`);
      if (f.type === 'enum') {
        lines.push(`        buf.push(self.${nm} as u8);`);
      } else if (f.type === 'float') {
        lines.push(`        buf.extend_from_slice(&self.${nm}.to_le_bytes());`);
      } else if (f.type === 'double') {
        lines.push(`        buf.extend_from_slice(&self.${nm}.to_le_bytes());`);
      } else if (f.type === 'bool') {
        lines.push(`        buf.push(if self.${nm} { 1 } else { 0 });`);
      } else if (f.type === 'string') {
        lines.push(`        let bytes = self.${nm}.as_bytes();`);
        lines.push(`        let mut padded = [0u8; ${ws}];`);
        lines.push(`        let len = bytes.len().min(${ws});`);
        lines.push(`        padded[..len].copy_from_slice(&bytes[..len]);`);
        lines.push(`        buf.extend_from_slice(&padded);`);
      } else if (f.type === 'bytes' || f.type === 'array') {
        lines.push(`        let mut padded = [0u8; ${ws}];`);
        lines.push(`        let len = self.${nm}.len().min(${ws});`);
        lines.push(`        padded[..len].copy_from_slice(&self.${nm}[..len]);`);
        lines.push(`        buf.extend_from_slice(&padded);`);
      } else {
        lines.push(`        buf.extend_from_slice(&(self.${nm} as ${rustType(f)}).to_le_bytes());`);
      }
    }
  }
  lines.push('    }');
  return lines.join('\n');
}

// ── 13. TLV Decode Body ───────────────────────────────────────────────────

function genRsTlvDecode(name: string, fields: ProtocolField[], ir: ProtocolIR): string {
  const lines: string[] = [
    '    pub fn decode_payload(buf: &[u8]) -> io::Result<Self> {',
    '        let mut pos = 0;',
    '        let mut msg = Self {',
  ];

  // Default values for all fields
  for (const f of fields) {
    const nm = f.name;
    if (f.type === 'vstring' || f.type === 'string') {
      lines.push(`            ${nm}: String::new(),`);
    } else if (f.type === 'vbytes' || f.type === 'bytes' || f.type === 'array') {
      lines.push(`            ${nm}: Vec::new(),`);
    } else if (f.type === 'bool') {
      lines.push(`            ${nm}: false,`);
    } else if (f.type === 'float' || f.type === 'double') {
      lines.push(`            ${nm}: 0.0,`);
    } else {
      lines.push(`            ${nm}: 0,`);
    }
  }
  lines.push('        };');
  lines.push('        while pos < buf.len() {');
  lines.push('            if pos + 3 > buf.len() {');
  lines.push('                return Err(io::Error::new(io::ErrorKind::InvalidData, "truncated TLV entry"));');
  lines.push('            }');
  lines.push('            let tag = buf[pos];');
  lines.push('            let field_len = u16::from_le_bytes([buf[pos+1], buf[pos+2]]) as usize;');
  lines.push('            pos += 3;');
  lines.push('            if pos + field_len > buf.len() {');
  lines.push('                return Err(io::Error::new(io::ErrorKind::InvalidData, "TLV value truncated"));');
  lines.push('            }');
  lines.push('            match tag {');

  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    const tag = f.fieldTag ?? fi;
    const nm = f.name;
    const ws = getFieldWireSize(f, ir);

    lines.push(`                ${tag} => { /* ${nm} */`);
    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`                    let vlen = u16::from_le_bytes([buf[pos], buf[pos+1]]) as usize;`);
      lines.push(`                    let vlen = vlen.min(${cap});`);
      lines.push(`                    msg.${nm} = String::from_utf8_lossy(&buf[pos+2..pos+2+vlen]).to_string();`);
      lines.push(`                    pos += 2 + vlen;`);
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`                    let vlen = u16::from_le_bytes([buf[pos], buf[pos+1]]) as usize;`);
      lines.push(`                    let vlen = vlen.min(${cap});`);
      lines.push(`                    msg.${nm} = buf[pos+2..pos+2+vlen].to_vec();`);
      lines.push(`                    pos += 2 + vlen;`);
    } else if (f.type === 'enum') {
      const en = findEnumForField(f, ir);
      if (en) {
        lines.push(`                    msg.${nm} = ${en.name}::from_u8(buf[pos]).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid ${en.name}"))?;`);
      } else {
        lines.push(`                    msg.${nm} = buf[pos];`);
      }
      lines.push(`                    pos += ${ws};`);
    } else if (f.type === 'float') {
      lines.push(`                    msg.${nm} = f32::from_le_bytes(buf[pos..pos+${ws}].try_into().unwrap());`);
      lines.push(`                    pos += ${ws};`);
    } else if (f.type === 'double') {
      lines.push(`                    msg.${nm} = f64::from_le_bytes(buf[pos..pos+${ws}].try_into().unwrap());`);
      lines.push(`                    pos += ${ws};`);
    } else if (f.type === 'bool') {
      lines.push(`                    msg.${nm} = buf[pos] != 0;`);
      lines.push(`                    pos += 1;`);
    } else if (f.type === 'string') {
      lines.push(`                    msg.${nm} = String::from_utf8_lossy(&buf[pos..pos+${ws}]).trim_end_matches('\\0').to_string();`);
      lines.push(`                    pos += ${ws};`);
    } else if (f.type === 'bytes' || f.type === 'array') {
      lines.push(`                    msg.${nm} = buf[pos..pos+${ws}].to_vec();`);
      lines.push(`                    pos += ${ws};`);
    } else if (ws === 1) {
      lines.push(`                    msg.${nm} = buf[pos];`);
      lines.push(`                    pos += 1;`);
    } else {
      lines.push(`                    msg.${nm} = ${rustType(f)}::from_le_bytes(buf[pos..pos+${ws}].try_into().unwrap());`);
      lines.push(`                    pos += ${ws};`);
    }
    lines.push('                },');
  }
  lines.push('                _ => { /* skip unknown tag */ pos += field_len; },');
  lines.push('            }');
  lines.push('        }');
  lines.push('        Ok(msg)');
  lines.push('    }');
  return lines.join('\n');
}

// ── 14. Flat Encode Body ──────────────────────────────────────────────────

function genRsFlatEncode(fields: ProtocolField[], ir: ProtocolIR): string {
  const lines: string[] = [
    '    pub fn encode_payload(&self, buf: &mut Vec<u8>) {',
  ];

  const hasVarField = fields.some((f) => f.type === 'vstring' || f.type === 'vbytes');
  if (hasVarField) {
    const sz = totalSize(fields, ir);
    lines.push(`        buf.reserve(${sz} + 128);`);
  } else {
    lines.push('        buf.reserve(Self::payload_size());');
  }

  for (const f of fields) {
    const nm = f.name;
    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`        let bytes = self.${nm}.as_bytes();`);
      lines.push(`        let vlen = bytes.len().min(${cap});`);
      lines.push(`        buf.extend_from_slice(&(vlen as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&bytes[..vlen]);`);
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`        let vlen = self.${nm}.len().min(${cap});`);
      lines.push(`        buf.extend_from_slice(&(vlen as u16).to_le_bytes());`);
      lines.push(`        buf.extend_from_slice(&self.${nm}[..vlen]);`);
    } else if (f.type === 'enum') {
      lines.push(`        buf.push(self.${nm} as u8);`);
    } else if (f.type === 'float') {
      lines.push(`        buf.extend_from_slice(&self.${nm}.to_le_bytes());`);
    } else if (f.type === 'double') {
      lines.push(`        buf.extend_from_slice(&self.${nm}.to_le_bytes());`);
    } else if (f.type === 'bool') {
      lines.push(`        buf.push(if self.${nm} { 1 } else { 0 });`);
    } else if (f.type === 'string') {
      const ws = getFieldWireSize(f, ir);
      lines.push(`        let bytes = self.${nm}.as_bytes();`);
      lines.push(`        let mut padded = [0u8; ${ws}];`);
      lines.push(`        let len = bytes.len().min(${ws});`);
      lines.push(`        padded[..len].copy_from_slice(&bytes[..len]);`);
      lines.push(`        buf.extend_from_slice(&padded);`);
    } else if (f.type === 'bytes' || f.type === 'array') {
      const ws = getFieldWireSize(f, ir);
      lines.push(`        let mut padded = [0u8; ${ws}];`);
      lines.push(`        let len = self.${nm}.len().min(${ws});`);
      lines.push(`        padded[..len].copy_from_slice(&self.${nm}[..len]);`);
      lines.push(`        buf.extend_from_slice(&padded);`);
    } else {
      lines.push(`        buf.extend_from_slice(&(self.${nm} as ${rustType(f)}).to_le_bytes());`);
    }
  }
  lines.push('    }');
  return lines.join('\n');
}

// ── 15. Flat Decode Body ──────────────────────────────────────────────────

function genRsFlatDecode(name: string, fields: ProtocolField[], ir: ProtocolIR): string {
  const hasVarField = fields.some((f) => f.type === 'vstring' || f.type === 'vbytes');
  const lines: string[] = [
    '    pub fn decode_payload(buf: &[u8]) -> io::Result<Self> {',
  ];

  if (!hasVarField) {
    lines.push('        if buf.len() < Self::payload_size() {');
    lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, "payload too small"));');
    lines.push('        }');
  }
  lines.push('        let mut pos = 0;');

  if (hasVarField) {
    lines.push('        let mut msg = Self {');
    for (const f of fields) {
      const nm = f.name;
      if (f.type === 'vstring' || f.type === 'string') {
        lines.push(`            ${nm}: String::new(),`);
      } else if (f.type === 'vbytes' || f.type === 'bytes' || f.type === 'array') {
        lines.push(`            ${nm}: Vec::new(),`);
      } else if (f.type === 'bool') {
        lines.push(`            ${nm}: false,`);
      } else if (f.type === 'float' || f.type === 'double') {
        lines.push(`            ${nm}: 0.0,`);
      } else {
        lines.push(`            ${nm}: 0,`);
      }
    }
    lines.push('        };');
  }

  for (const f of fields) {
    const ws = getFieldWireSize(f, ir);
    const nm = f.name;
    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`        let vlen = u16::from_le_bytes([buf[pos], buf[pos+1]]) as usize;`);
      lines.push(`        let vlen = vlen.min(${cap});`);
      lines.push('        pos += 2;');
      lines.push(`        msg.${nm} = String::from_utf8_lossy(&buf[pos..pos+vlen]).to_string();`);
      lines.push('        pos += vlen;');
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`        let vlen = u16::from_le_bytes([buf[pos], buf[pos+1]]) as usize;`);
      lines.push(`        let vlen = vlen.min(${cap});`);
      lines.push('        pos += 2;');
      lines.push(`        msg.${nm} = buf[pos..pos+vlen].to_vec();`);
      lines.push('        pos += vlen;');
    } else if (f.type === 'enum') {
      const en = findEnumForField(f, ir);
      if (en) {
        lines.push(`        let ${nm} = ${en.name}::from_u8(buf[pos]).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid ${en.name} value"))?;`);
      } else {
        lines.push(`        let ${nm} = buf[pos];`);
      }
      lines.push(`        pos += ${ws};`);
    } else if (f.type === 'float') {
      lines.push(`        let ${nm} = f32::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());`);
      lines.push(`        pos += ${ws};`);
    } else if (f.type === 'double') {
      lines.push(`        let ${nm} = f64::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());`);
      lines.push(`        pos += ${ws};`);
    } else if (f.type === 'bool') {
      lines.push(`        let ${nm} = buf[pos] != 0;`);
      lines.push('        pos += 1;');
    } else if (f.type === 'string') {
      lines.push(`        let ${nm} = String::from_utf8_lossy(&buf[pos..pos + ${ws}]).trim_end_matches('\\0').to_string();`);
      lines.push(`        pos += ${ws};`);
    } else if (f.type === 'bytes' || f.type === 'array') {
      lines.push(`        let ${nm} = buf[pos..pos + ${ws}].to_vec();`);
      lines.push(`        pos += ${ws};`);
    } else if (ws === 1) {
      lines.push(`        let ${nm} = buf[pos];`);
      lines.push('        pos += 1;');
    } else {
      lines.push(`        let ${nm} = ${rustType(f)}::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());`);
      lines.push(`        pos += ${ws};`);
    }
  }

  if (!hasVarField) {
    lines.push(`        Ok(Self { ${fields.map((f) => f.name).join(', ')} })`);
  } else {
    lines.push('        Ok(msg)');
  }
  lines.push('    }');
  return lines.join('\n');
}

// ── 16. Validation Body ───────────────────────────────────────────────────

function genRsValidation(name: string, fields: ProtocolField[]): string {
  const lines: string[] = [
    '    pub fn validate(&self) -> io::Result<()> {',
  ];
  let hasRangeChecks = false;
  for (const f of fields) {
    if (f.minValue !== undefined || f.maxValue !== undefined) {
      hasRangeChecks = true;
      const nm = f.name;
      const checks: string[] = [];
      if (f.minValue !== undefined) {
        checks.push(`self.${nm} < ${f.minValue}`);
      }
      if (f.maxValue !== undefined) {
        checks.push(`self.${nm} > ${f.maxValue}`);
      }
      lines.push(`        if ${checks.join(' || ')} {`);
      lines.push(`            return Err(io::Error::new(io::ErrorKind::InvalidData, "${name}.${nm} out of range"));`);
      lines.push('        }');
    }
  }
  lines.push('        Ok(())');
  lines.push('    }');
  return lines.join('\n');
}

// ── 17. Full Encode (header + payload + CRC) ──────────────────────────────

function genRsEncode(name: string, idx: number, modules: ProtocolModules): string {
  const lines: string[] = [
    '    pub fn encode(&self) -> Vec<u8> {',
  ];
  const crcSuffix = modules.crc ? ' + PROTOCOL_CRC_SIZE' : '';
  lines.push('        let mut payload = Vec::new();');
  lines.push('        self.encode_payload(&mut payload);');
  lines.push('        let actual_payload_len = payload.len() as u16;');
  lines.push(`        let header = ProtocolHeader::new(${idx} as u8, actual_payload_len);`);
  lines.push(`        let mut buf = Vec::with_capacity(PROTOCOL_HEADER_SIZE + payload.len()${crcSuffix});`);
  lines.push('        header.encode(&mut buf);');
  lines.push('        buf.extend_from_slice(&payload);');
  if (modules.crc) {
    lines.push('        let crc = crc16(&buf);');
    lines.push('        buf.extend_from_slice(&crc.to_le_bytes());');
  }
  lines.push('        buf');
  lines.push('    }');
  return lines.join('\n');
}

// ── 18. Full Decode (header + payload) ────────────────────────────────────

function genRsDecode(name: string, modules: ProtocolModules): string {
  const lines: string[] = [
    '    pub fn decode(buf: &[u8]) -> io::Result<(ProtocolHeader, Self)> {',
  ];
  const hdrSize = getHeaderSize(modules);
  if (modules.crc) {
    lines.push('        if buf.len() < PROTOCOL_HEADER_SIZE + PROTOCOL_CRC_SIZE {');
    lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, "packet too small"));');
    lines.push('        }');
    lines.push('        let crc_end = buf.len();');
    lines.push('        let (data, crc_bytes) = buf.split_at(crc_end - PROTOCOL_CRC_SIZE);');
    lines.push('        let stored_crc = u16::from_le_bytes(crc_bytes.try_into().unwrap());');
    lines.push('        let calc_crc = crc16(data);');
    lines.push('        if stored_crc != calc_crc {');
    lines.push('            return Err(io::Error::new(io::ErrorKind::InvalidData, "CRC mismatch"));');
    lines.push('        }');
    lines.push('        let header = ProtocolHeader::decode(data)?;');
    lines.push(`        let payload = &data[${hdrSize}..];`);
    lines.push('        let msg = Self::decode_payload(payload)?;');
  } else {
    lines.push('        let header = ProtocolHeader::decode(buf)?;');
    lines.push(`        let msg = Self::decode_payload(&buf[${hdrSize}..])?;`);
  }
  lines.push('        Ok((header, msg))');
  lines.push('    }');
  return lines.join('\n');
}

// ── 11. Message Impl (orchestrates 12-18) ─────────────────────────────────

function genRsMessageImpl(
  name: string,
  fields: ProtocolField[],
  idx: number,
  modules: ProtocolModules,
  ir: ProtocolIR,
): string {
  const parts: string[] = [];
  parts.push(`impl ${name} {`);

  const hasVarField = fields.some((f) => f.type === 'vstring' || f.type === 'vbytes');

  if (modules.tlv) {
    // Tag constants
    for (let fi = 0; fi < fields.length; fi++) {
      const tag = fields[fi].fieldTag ?? fi;
      parts.push(`    pub const TAG_${fields[fi].name}: u8 = ${tag};`);
    }
  }

  // payload_size()
  if (modules.tlv) {
    const sz = totalSize(fields, ir);
    const tlvMaxSz = sz + 3 * fields.length;
    parts.push(`    pub const fn payload_size() -> usize { ${tlvMaxSz} }`);
  } else if (!hasVarField) {
    const sz = totalSize(fields, ir);
    parts.push(`    pub const fn payload_size() -> usize { ${sz} }`);
  } else {
    const sz = totalSize(fields, ir);
    parts.push('    /// Estimated maximum payload size. Actual size may vary with string lengths.');
    parts.push(`    pub const fn payload_size() -> usize { ${sz} }`);
  }

  // encode_payload
  parts.push('');
  if (modules.tlv) {
    parts.push(genRsTlvEncode(name, fields, ir));
  } else {
    parts.push(genRsFlatEncode(fields, ir));
  }

  // decode_payload
  parts.push('');
  if (modules.tlv) {
    parts.push(genRsTlvDecode(name, fields, ir));
  } else {
    parts.push(genRsFlatDecode(name, fields, ir));
  }

  // validation (L2+)
  if (modules.validation) {
    const hasRangeFields = fields.some((f) => f.minValue !== undefined || f.maxValue !== undefined);
    if (hasRangeFields) {
      parts.push('');
      parts.push(genRsValidation(name, fields));
    }
  }

  // Full encode/decode with header
  if (modules.header) {
    parts.push('');
    parts.push(genRsEncode(name, idx, modules));
    parts.push('');
    parts.push(genRsDecode(name, modules));
  }

  parts.push('}');
  parts.push('');
  return parts.join('\n');
}

// ── 19. Generic decode_packet ─────────────────────────────────────────────

function genRsDecodePacket(ir: ProtocolIR, modules: ProtocolModules): string {
  const msgNames = ir.messages.map((m) => m.name);
  if (msgNames.length === 0) return '';

  const lines: string[] = [
    'pub fn decode_packet(buf: &[u8]) -> io::Result<(ProtocolHeader, Vec<u8>)> {',
  ];

  if (modules.crc) {
    lines.push('    let packet_len = buf.len();');
    lines.push('    if packet_len < PROTOCOL_HEADER_SIZE + PROTOCOL_CRC_SIZE {');
    lines.push('        return Err(io::Error::new(io::ErrorKind::InvalidData, "packet too small"));');
    lines.push('    }');
    lines.push('    let (data, crc_bytes) = buf.split_at(packet_len - PROTOCOL_CRC_SIZE);');
    lines.push('    let stored_crc = u16::from_le_bytes(crc_bytes.try_into().unwrap());');
    lines.push('    let calc_crc = crc16(data);');
    lines.push('    if stored_crc != calc_crc {');
    lines.push('        return Err(io::Error::new(io::ErrorKind::InvalidData, "CRC mismatch"));');
    lines.push('    }');
    lines.push('    let header = ProtocolHeader::decode(data)?;');
    lines.push('    let payload = data[PROTOCOL_HEADER_SIZE..PROTOCOL_HEADER_SIZE + header.payload_len as usize].to_vec();');
  } else {
    lines.push('    let header = ProtocolHeader::decode(buf)?;');
    lines.push('    let payload = buf[PROTOCOL_HEADER_SIZE..PROTOCOL_HEADER_SIZE + header.payload_len as usize].to_vec();');
  }
  lines.push('    Ok((header, payload))');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ── Main Entry Point ──────────────────────────────────────────────────────

export function generateRust(ir: ProtocolIR): string {
  const modules = resolveModules(ir);
  const parts: string[] = [];

  parts.push(genRsImports());

  const msgNames = ir.messages.map((m) => m.name);
  const hasMessages = msgNames.length > 0;

  // Constants
  parts.push(genRsConstants(modules));

  // CRC function
  if (modules.crc) {
    parts.push(genRsCrcFunction());
  }

  // MsgType enum + impl (only when header is used)
  if (modules.header && hasMessages) {
    parts.push(genRsMsgTypeEnum(msgNames));
    parts.push(genRsMsgTypeImpl(msgNames));
  }

  // ProtocolHeader struct + impl
  if (modules.header) {
    parts.push(genRsHeaderStruct(modules));
    parts.push(genRsHeaderImpl(modules, ir.endian));
  }

  // User enums
  for (const en of ir.enums) {
    parts.push(genRsUserEnum(en));
  }

  // Struct definitions (no impl block for structs)
  for (const st of ir.structs) {
    const fields = st.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    parts.push(genRsStructDef(st.name, fields, ir));
  }

  // Message definitions + impl blocks
  for (let i = 0; i < ir.messages.length; i++) {
    const msg = ir.messages[i];
    const fields = msg.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    parts.push(genRsStructDef(msg.name, fields, ir));
    parts.push(genRsMessageImpl(msg.name, fields, i, modules, ir));
  }

  // Generic decode_packet (only with header)
  if (modules.header && hasMessages) {
    parts.push(genRsDecodePacket(ir, modules));
  }

  return parts.join('\n');
}
