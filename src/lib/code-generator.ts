import type { ProtocolIR, ProtocolField, FieldType } from '@/types/protocol';

function cType(field: ProtocolField): string {
  const map: Record<FieldType, string> = {
    uint8: 'uint8_t',
    int8: 'int8_t',
    uint16: 'uint16_t',
    int16: 'int16_t',
    uint32: 'uint32_t',
    int32: 'int32_t',
    uint64: 'uint64_t',
    int64: 'int64_t',
    float: 'float',
    double: 'double',
    bool: 'bool',
    char: 'char',
    string: 'char*',
    bytes: 'uint8_t*',
    struct: 'void*',
    enum: 'int',
    array: 'void*',
  };
  return map[field.type] || 'void*';
}

function cEncodeField(field: ProtocolField, bufVar: string, msgVar: string, offset: string): string {
  const name = field.name;
  const val = `${msgVar}->${name}`;

  if (field.type === 'struct') {
    return `    // TODO: encode struct ${name}\n`;
  }

  const sizeMap: Record<string, string> = {
    uint8: '1', int8: '1',
    uint16: '2', int16: '2',
    uint32: '4', int32: '4',
    uint64: '8', int64: '8',
    float: '4', double: '8',
    bool: '1', char: '1',
  };

  if (sizeMap[field.type]) {
    return `    memcpy(${bufVar} + ${offset}, &${val}, ${sizeMap[field.type]});\n`;
  }

  if (field.type === 'string') {
    const len = field.length || 256;
    return `    strncpy(${bufVar} + ${offset}, ${val}, ${len});\n`;
  }

  return `    // TODO: encode ${field.type} ${name}\n`;
}

function cDecodeField(field: ProtocolField, bufVar: string, msgVar: string, offset: string): string {
  const name = field.name;
  const val = `${msgVar}->${name}`;

  if (field.type === 'struct') {
    return `    // TODO: decode struct ${name}\n`;
  }

  const sizeMap: Record<string, string> = {
    uint8: '1', int8: '1',
    uint16: '2', int16: '2',
    uint32: '4', int32: '4',
    uint64: '8', int64: '8',
    float: '4', double: '8',
    bool: '1', char: '1',
  };

  if (sizeMap[field.type]) {
    return `    memcpy(&${val}, ${bufVar} + ${offset}, ${sizeMap[field.type]});\n`;
  }

  if (field.type === 'string') {
    const len = field.length || 256;
    return `    strncpy(${val}, ${bufVar} + ${offset}, ${len});\n`;
  }

  return `    // TODO: decode ${field.type} ${name}\n`;
}

export function generateC(ir: ProtocolIR): string {
  let output = `#include <stdint.h>\n#include <stdbool.h>\n#include <string.h>\n\n`;

  for (const en of ir.enums) {
    output += `typedef enum {\n`;
    const entries = Object.entries(en.values);
    for (let i = 0; i < entries.length; i++) {
      const [key, val] = entries[i];
      output += `    ${key} = ${val}`;
      if (i < entries.length - 1) output += ',';
      output += '\n';
    }
    output += `} ${en.name};\n\n`;
  }

  for (const st of ir.structs) {
    output += `typedef struct {\n`;
    for (const fieldId of st.fields) {
      const field = ir.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      output += `    ${cType(field)} ${field.name}`;
      if (field.length && field.type !== 'string') {
        output += `[${field.length}]`;
      }
      output += ';\n';
    }
    output += `} ${st.name};\n\n`;
  }

  for (const msg of ir.messages) {
    output += `typedef struct {\n`;
    for (const fieldId of msg.fields) {
      const field = ir.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      output += `    ${cType(field)} ${field.name}`;
      if (field.length && field.type !== 'string') {
        output += `[${field.length}]`;
      }
      output += ';\n';
    }
    output += `} ${msg.name};\n\n`;

    const fields = msg.fields
      .map((fid) => ir.fields.find((f) => f.id === fid))
      .filter(Boolean) as ProtocolField[];

    output += `int encode_${msg.name}(uint8_t* buf, ${msg.name}* msg) {\n`;
    output += `    int offset = 0;\n`;
    for (const field of fields) {
      output += cEncodeField(field, 'buf', 'msg', 'offset');
    }
    output += `    return offset;\n`;
    output += `}\n\n`;

    output += `int decode_${msg.name}(uint8_t* buf, ${msg.name}* msg) {\n`;
    output += `    int offset = 0;\n`;
    for (const field of fields) {
      output += cDecodeField(field, 'buf', 'msg', 'offset');
    }
    output += `    return offset;\n`;
    output += `}\n\n`;
  }

  return output;
}

export function generatePython(ir: ProtocolIR): string {
  let output = `import struct\n\n`;

  for (const en of ir.enums) {
    output += `class ${en.name}:\n`;
    for (const [key, val] of Object.entries(en.values)) {
      output += `    ${key} = ${val}\n`;
    }
    output += '\n';
  }

  for (const msg of ir.messages) {
    const fields = msg.fields
      .map((fid) => ir.fields.find((f) => f.id === fid))
      .filter(Boolean) as ProtocolField[];

    output += `class ${msg.name}:\n`;
    output += `    def __init__(self):\n`;
    for (const field of fields) {
      if (field.type === 'string') {
        output += `        self.${field.name} = ""\n`;
      } else if (field.type === 'float') {
        output += `        self.${field.name} = 0.0\n`;
      } else {
        output += `        self.${field.name} = 0\n`;
      }
    }
    output += '\n';

    const formatMap: Record<string, string> = {
      uint8: 'B', int8: 'b',
      uint16: 'H', int16: 'h',
      uint32: 'I', int32: 'i',
      uint64: 'Q', int64: 'q',
      float: 'f', double: 'd',
      bool: '?',
    };

    const fmt = fields
      .map((f) => formatMap[f.type] || 'x')
      .join('');

    output += `    def encode(self) -> bytes:\n`;
    output += `        return struct.pack("${fmt}"`;
    for (const field of fields) {
      output += `, self.${field.name}`;
    }
    output += `)\n\n`;

    output += `    @classmethod\n`;
    output += `    def decode(cls, data: bytes) -> "${msg.name}":\n`;
    output += `        msg = cls()\n`;
    output += `        values = struct.unpack("${fmt}", data)\n`;
    for (let i = 0; i < fields.length; i++) {
      output += `        msg.${fields[i].name} = values[${i}]\n`;
    }
    output += `        return msg\n\n`;
  }

  return output;
}

export function generateRust(ir: ProtocolIR): string {
  let output = `use serde::{Deserialize, Serialize};\n\n`;

  for (const en in ir.enums) {
    const e = ir.enums[en];
    output += `#[derive(Debug, Clone, Copy, Serialize, Deserialize)]\npub enum ${e.name} {\n`;
    for (const [key, val] of Object.entries(e.values)) {
      output += `    ${key} = ${val},\n`;
    }
    output += `}\n\n`;
  }

  for (const st of ir.structs) {
    output += `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${st.name} {\n`;
    for (const fieldId of st.fields) {
      const field = ir.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      const rustType = field.type === 'uint8' ? 'u8'
        : field.type === 'int8' ? 'i8'
        : field.type === 'uint16' ? 'u16'
        : field.type === 'int16' ? 'i16'
        : field.type === 'uint32' ? 'u32'
        : field.type === 'int32' ? 'i32'
        : field.type === 'uint64' ? 'u64'
        : field.type === 'int64' ? 'i64'
        : field.type === 'float' ? 'f32'
        : field.type === 'double' ? 'f64'
        : field.type === 'bool' ? 'bool'
        : field.type === 'string' ? 'String'
        : 'Vec<u8>';
      output += `    pub ${field.name}: ${rustType},\n`;
    }
    output += `}\n\n`;
  }

  for (const msg of ir.messages) {
    output += `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${msg.name} {\n`;
    for (const fieldId of msg.fields) {
      const field = ir.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      const rustType = field.type === 'uint8' ? 'u8'
        : field.type === 'int8' ? 'i8'
        : field.type === 'uint16' ? 'u16'
        : field.type === 'int16' ? 'i16'
        : field.type === 'uint32' ? 'u32'
        : field.type === 'int32' ? 'i32'
        : field.type === 'uint64' ? 'u64'
        : field.type === 'int64' ? 'i64'
        : field.type === 'float' ? 'f32'
        : field.type === 'double' ? 'f64'
        : field.type === 'bool' ? 'bool'
        : field.type === 'string' ? 'String'
        : 'Vec<u8>';
      output += `    pub ${field.name}: ${rustType},\n`;
    }
    output += `}\n\n`;
  }

  return output;
}
