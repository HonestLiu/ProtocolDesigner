import type { ProtocolIR, ProtocolField, FieldType } from '@/types/protocol';

function findEnumForField(field: ProtocolField, ir: ProtocolIR): { name: string; values: Record<string, number> } | null {
  if (field.type !== 'enum') return null;
  // Match enum by field name patterns or first enum if only one
  if (ir.enums.length === 0) return null;
  const byName = ir.enums.find((e) =>
    field.name.toLowerCase().includes(e.name.toLowerCase().replace(/[a-z]/g, '')) ||
    field.name.toLowerCase().includes(e.name.toLowerCase())
  );
  if (byName) return byName;
  // Try matching field name to enum member names
  for (const en of ir.enums) {
    const fieldBase = field.name.replace(/_?code$/, '').replace(/_?type$/, '').replace(/_?status$/, '');
    if (en.name.toLowerCase().includes(fieldBase)) return en;
  }
  return ir.enums[0];
}

function getEnumWireSize(field: ProtocolField, ir: ProtocolIR): number {
  const en = findEnumForField(field, ir);
  if (!en) return 1;
  const maxVal = Math.max(...Object.values(en.values));
  if (maxVal <= 0xFF) return 1;
  if (maxVal <= 0xFFFF) return 2;
  return 4;
}

function getFieldWireSize(field: ProtocolField, ir: ProtocolIR): number {
  if (field.type === 'enum') return getEnumWireSize(field, ir);
  const sizeMap: Record<string, number> = {
    uint8: 1, int8: 1,
    uint16: 2, int16: 2,
    uint32: 4, int32: 4,
    uint64: 8, int64: 8,
    float: 4, double: 8,
    bool: 1, char: 1,
  };
  if (sizeMap[field.type]) return sizeMap[field.type];
  if (field.type === 'string') return field.length || 256;
  if (field.type === 'bytes' || field.type === 'array') return field.length || 1;
  return 1;
}

function totalSize(fields: ProtocolField[], ir: ProtocolIR): number {
  return fields.reduce((acc, f) => acc + getFieldWireSize(f, ir), 0);
}

export function generateC(ir: ProtocolIR): string {
  let out = `#include <stdint.h>\n#include <string.h>\n#include <stdbool.h>\n\n`;

  out += `#define PROTOCOL_MAGIC    0xAA55\n`;
  out += `#define PROTOCOL_VERSION  1\n`;
  out += `#define PROTOCOL_HEADER_SIZE  6\n\n`;

  // All sendable types (messages + structs) get a MsgType
  const allTypes = [
    ...ir.messages.map((m) => ({ name: m.name, kind: 'msg' as const })),
    ...ir.structs.map((s) => ({ name: s.name, kind: 'struct' as const })),
  ];

  if (allTypes.length > 0) {
    out += `typedef enum {\n`;
    for (let i = 0; i < allTypes.length; i++) {
      out += `    MSG_TYPE_${allTypes[i].name} = ${i},\n`;
    }
    out += `    MSG_TYPE_COUNT\n`;
    out += `} MsgType;\n\n`;
  }

  out += `typedef struct __attribute__((packed)) {\n`;
  out += `    uint16_t magic;\n`;
  out += `    uint8_t  version;\n`;
  out += `    uint8_t  msg_type;\n`;
  out += `    uint16_t payload_len;\n`;
  out += `} ProtocolHeader;\n\n`;

  out += `static inline int encode_header(uint8_t *buf, size_t buf_len, uint8_t msg_type, uint16_t payload_len) {\n`;
  out += `    if (buf_len < PROTOCOL_HEADER_SIZE) return -1;\n`;
  out += `    buf[0] = (uint8_t)(PROTOCOL_MAGIC & 0xFF);\n`;
  out += `    buf[1] = (uint8_t)((PROTOCOL_MAGIC >> 8) & 0xFF);\n`;
  out += `    buf[2] = PROTOCOL_VERSION;\n`;
  out += `    buf[3] = msg_type;\n`;
  out += `    buf[4] = (uint8_t)(payload_len & 0xFF);\n`;
  out += `    buf[5] = (uint8_t)((payload_len >> 8) & 0xFF);\n`;
  out += `    return PROTOCOL_HEADER_SIZE;\n`;
  out += `}\n\n`;

  out += `static inline int decode_header(const uint8_t *buf, size_t buf_len, ProtocolHeader *hdr) {\n`;
  out += `    if (buf_len < PROTOCOL_HEADER_SIZE) return -1;\n`;
  out += `    hdr->magic       = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);\n`;
  out += `    hdr->version     = buf[2];\n`;
  out += `    hdr->msg_type    = buf[3];\n`;
  out += `    hdr->payload_len = (uint16_t)buf[4] | ((uint16_t)buf[5] << 8);\n`;
  out += `    if (hdr->magic != PROTOCOL_MAGIC) return -2;\n`;
  out += `    if (hdr->version != PROTOCOL_VERSION) return -3;\n`;
  out += `    return PROTOCOL_HEADER_SIZE;\n`;
  out += `}\n\n`;

  // User enums
  for (const en of ir.enums) {
    out += `typedef enum {\n`;
    const entries = Object.entries(en.values);
    for (let i = 0; i < entries.length; i++) {
      const [key, val] = entries[i];
      out += `    ${en.name}_${key} = ${val},\n`;
    }
    out += `} ${en.name};\n\n`;
  }

  // Helper to find the correct enum for a field
  const resolveEnum = (field: ProtocolField): { name: string; wireType: string } | null => {
    if (field.type !== 'enum') return null;
    // Try matching field name to enum: "error_code" -> look for enum with "error" or "Error"
    const fieldBase = field.name.replace(/_?code$/, '').replace(/_?type$/, '').replace(/_?status$/, '');
    for (const en of ir.enums) {
      if (en.name.toLowerCase().includes(fieldBase.toLowerCase())) return { name: en.name, wireType: 'uint8_t' };
    }
    // Fallback: match any enum whose values contain the field's name concept
    for (const en of ir.enums) {
      const firstKey = Object.keys(en.values)[0]?.toLowerCase() || '';
      if (field.name.toLowerCase().includes(firstKey.replace(/s$/, ''))) return { name: en.name, wireType: 'uint8_t' };
    }
    // Last resort: if only one enum, use it
    if (ir.enums.length === 1) return { name: ir.enums[0].name, wireType: 'uint8_t' };
    return null;
  };

  const cFieldDef = (field: ProtocolField): string => {
    if (field.type === 'enum') {
      const resolved = resolveEnum(field);
      return `${resolved ? resolved.name : 'uint8_t'} ${field.name}`;
    }
    if (field.type === 'string') return `char ${field.name}[${field.length || 256}]`;
    if (field.type === 'bytes' || field.type === 'array') return `uint8_t ${field.name}[${field.length || 1}]`;
    const typeMap: Record<string, string> = {
      uint8: 'uint8_t', int8: 'int8_t', uint16: 'uint16_t', int16: 'int16_t',
      uint32: 'uint32_t', int32: 'int32_t', uint64: 'uint64_t', int64: 'int64_t',
      float: 'float', double: 'double', bool: 'uint8_t', char: 'char',
    };
    return `${typeMap[field.type] || 'uint8_t'} ${field.name}`;
  };

  const fieldWireSize = (field: ProtocolField): number => {
    if (field.type === 'enum') return 1;
    const map: Record<string, number> = {
      uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4,
      uint64: 8, int64: 8, float: 4, double: 8, bool: 1, char: 1,
    };
    if (map[field.type]) return map[field.type];
    if (field.type === 'string') return field.length || 256;
    if (field.type === 'bytes' || field.type === 'array') return field.length || 1;
    return 1;
  };

  const totalPayloadSize = (fields: ProtocolField[]): number =>
    fields.reduce((acc, f) => acc + fieldWireSize(f), 0);

  const encodeField = (field: ProtocolField, indent: string): string => {
    const nm = field.name;
    const sz = fieldWireSize(field);

    if (field.type === 'enum') {
      return `${indent}buf[offset] = (uint8_t)msg->${nm};\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint16' || field.type === 'int16') {
      return `${indent}buf[offset]     = (uint8_t)(msg->${nm} & 0xFF);\n${indent}buf[offset + 1] = (uint8_t)((msg->${nm} >> 8) & 0xFF);\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint32' || field.type === 'int32') {
      return `${indent}buf[offset]     = (uint8_t)(msg->${nm} & 0xFF);\n${indent}buf[offset + 1] = (uint8_t)((msg->${nm} >> 8) & 0xFF);\n${indent}buf[offset + 2] = (uint8_t)((msg->${nm} >> 16) & 0xFF);\n${indent}buf[offset + 3] = (uint8_t)((msg->${nm} >> 24) & 0xFF);\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint64' || field.type === 'int64') {
      return `${indent}{ uint64_t v = (uint64_t)msg->${nm};\n${indent}  for (int i = 0; i < 8; i++) buf[offset + i] = (uint8_t)(v >> (i * 8));\n${indent}}\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'float') {
      return `${indent}{ uint32_t tmp; memcpy(&tmp, &msg->${nm}, 4);\n${indent}  buf[offset] = (uint8_t)(tmp & 0xFF); buf[offset+1] = (uint8_t)((tmp>>8)&0xFF);\n${indent}  buf[offset+2] = (uint8_t)((tmp>>16)&0xFF); buf[offset+3] = (uint8_t)((tmp>>24)&0xFF); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'double') {
      return `${indent}{ uint64_t tmp; memcpy(&tmp, &msg->${nm}, 8);\n${indent}  for (int i = 0; i < 8; i++) buf[offset+i] = (uint8_t)(tmp >> (i*8)); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'bool') {
      return `${indent}buf[offset] = msg->${nm} ? 1 : 0;\n${indent}offset += 1;\n`;
    }
    if (field.type === 'string') {
      return `${indent}memcpy(buf + offset, msg->${nm}, ${sz});\n${indent}buf[offset + ${sz} - 1] = '\\0';\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'bytes' || field.type === 'array') {
      return `${indent}memcpy(buf + offset, msg->${nm}, ${sz});\n${indent}offset += ${sz};\n`;
    }
    return `${indent}buf[offset] = (uint8_t)msg->${nm};\n${indent}offset += 1;\n`;
  };

  const decodeField = (field: ProtocolField, indent: string): string => {
    const nm = field.name;
    const sz = fieldWireSize(field);

    if (field.type === 'enum') {
      const resolved = resolveEnum(field);
      if (resolved) {
        return `${indent}msg->${nm} = (${resolved.name})buf[offset];\n${indent}offset += ${sz};\n`;
      }
      return `${indent}msg->${nm} = buf[offset];\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint16') {
      return `${indent}msg->${nm} = (uint16_t)buf[offset] | ((uint16_t)buf[offset+1] << 8);\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'int16') {
      return `${indent}{ uint16_t t = (uint16_t)buf[offset] | ((uint16_t)buf[offset+1] << 8); memcpy(&msg->${nm}, &t, 2); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint32') {
      return `${indent}msg->${nm} = (uint32_t)buf[offset] | ((uint32_t)buf[offset+1]<<8) | ((uint32_t)buf[offset+2]<<16) | ((uint32_t)buf[offset+3]<<24);\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'int32') {
      return `${indent}{ uint32_t t = (uint32_t)buf[offset] | ((uint32_t)buf[offset+1]<<8) | ((uint32_t)buf[offset+2]<<16) | ((uint32_t)buf[offset+3]<<24); memcpy(&msg->${nm}, &t, 4); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'uint64') {
      return `${indent}msg->${nm} = 0;\n${indent}for (int i = 0; i < 8; i++) msg->${nm} |= ((uint64_t)buf[offset+i]) << (i*8);\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'int64') {
      return `${indent}{ uint64_t t = 0;\n${indent}  for (int i = 0; i < 8; i++) t |= ((uint64_t)buf[offset+i]) << (i*8);\n${indent}  memcpy(&msg->${nm}, &t, 8); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'float') {
      return `${indent}{ uint32_t t = (uint32_t)buf[offset] | ((uint32_t)buf[offset+1]<<8) | ((uint32_t)buf[offset+2]<<16) | ((uint32_t)buf[offset+3]<<24);\n${indent}  memcpy(&msg->${nm}, &t, 4); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'double') {
      return `${indent}{ uint64_t t = 0;\n${indent}  for (int i = 0; i < 8; i++) t |= ((uint64_t)buf[offset+i]) << (i*8);\n${indent}  memcpy(&msg->${nm}, &t, 8); }\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'bool') {
      return `${indent}msg->${nm} = buf[offset] ? 1 : 0;\n${indent}offset += 1;\n`;
    }
    if (field.type === 'string') {
      return `${indent}memcpy(msg->${nm}, buf + offset, ${sz});\n${indent}msg->${nm}[${sz} - 1] = '\\0';\n${indent}offset += ${sz};\n`;
    }
    if (field.type === 'bytes' || field.type === 'array') {
      return `${indent}memcpy(msg->${nm}, buf + offset, ${sz});\n${indent}offset += ${sz};\n`;
    }
    return `${indent}msg->${nm} = buf[offset];\n${indent}offset += 1;\n`;
  };

  // Struct definitions
  for (const st of ir.structs) {
    const fields = st.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    out += `typedef struct __attribute__((packed)) {\n`;
    for (const f of fields) out += `    ${cFieldDef(f)};\n`;
    out += `} ${st.name};\n\n`;
  }

  // Message definitions
  for (const msg of ir.messages) {
    const fields = msg.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    out += `typedef struct __attribute__((packed)) {\n`;
    for (const f of fields) out += `    ${cFieldDef(f)};\n`;
    out += `} ${msg.name};\n\n`;
  }

  // Encode/decode for all types (messages + structs) with full header support
  for (let i = 0; i < allTypes.length; i++) {
    const t = allTypes[i];
    const source = t.kind === 'msg'
      ? ir.messages.find((m) => m.name === t.name)!
      : ir.structs.find((s) => s.name === t.name)!;
    const fields = source.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    const sz = totalPayloadSize(fields);
    const indent = '    ';

    // Payload-only encode
    out += `static inline int encode_${t.name}_payload(uint8_t *buf, size_t buf_len, const ${t.name} *msg) {\n`;
    out += `${indent}if (buf_len < ${sz}) return -1;\n`;
    out += `${indent}int offset = 0;\n`;
    for (const f of fields) out += encodeField(f, indent);
    out += `${indent}return offset;\n}\n\n`;

    // Payload-only decode
    out += `static inline int decode_${t.name}_payload(const uint8_t *buf, size_t buf_len, ${t.name} *msg) {\n`;
    out += `${indent}if (buf_len < ${sz}) return -1;\n`;
    out += `${indent}int offset = 0;\n`;
    for (const f of fields) out += decodeField(f, indent);
    out += `${indent}return offset;\n}\n\n`;

    // Full packet encode (header + payload)
    out += `int encode_${t.name}(uint8_t *buf, size_t buf_len, const ${t.name} *msg) {\n`;
    out += `${indent}if (buf_len < PROTOCOL_HEADER_SIZE + ${sz}) return -1;\n`;
    out += `${indent}int offset = 0;\n`;
    out += `${indent}int hdr_ret = encode_header(buf + offset, buf_len - offset, MSG_TYPE_${t.name}, ${sz});\n`;
    out += `${indent}if (hdr_ret < 0) return hdr_ret;\n`;
    out += `${indent}offset += hdr_ret;\n`;
    out += `${indent}int pay_ret = encode_${t.name}_payload(buf + offset, buf_len - offset, msg);\n`;
    out += `${indent}if (pay_ret < 0) return pay_ret;\n`;
    out += `${indent}offset += pay_ret;\n`;
    out += `${indent}return offset;\n}\n\n`;

    // Full packet decode (expects buf pointing to payload after header)
    out += `int decode_${t.name}(const uint8_t *buf, size_t buf_len, ${t.name} *msg) {\n`;
    out += `${indent}return decode_${t.name}_payload(buf, buf_len, msg);\n`;
    out += `}\n\n`;

    out += `int ${t.name}_size(void) { return ${sz}; }\n\n`;
  }

  // Generic decode_packet
  if (allTypes.length > 0) {
    out += `int decode_packet(const uint8_t *buf, size_t buf_len, ProtocolHeader *hdr, const uint8_t **payload_buf, uint16_t *payload_len) {\n`;
    out += `    int ret = decode_header(buf, buf_len, hdr);\n`;
    out += `    if (ret < 0) return ret;\n`;
    out += `    if (hdr->msg_type >= MSG_TYPE_COUNT) return -4;\n`;
    out += `    if (buf_len < PROTOCOL_HEADER_SIZE + hdr->payload_len) return -5;\n`;
    out += `    *payload_buf = buf + PROTOCOL_HEADER_SIZE;\n`;
    out += `    *payload_len = hdr->payload_len;\n`;
    out += `    return hdr->msg_type;\n`;
    out += `}\n\n`;
  }

  return out;
}

export function generatePython(ir: ProtocolIR): string {
  let out = `import struct\n\n`;

  out += `PROTOCOL_MAGIC = 0xAA55\n`;
  out += `PROTOCOL_VERSION = 1\n`;
  out += `PROTOCOL_HEADER_SIZE = 6\n\n`;

  // MsgType enum
  if (ir.messages.length > 0) {
    out += `class MsgType:\n`;
    ir.messages.forEach((msg, i) => {
      out += `    ${msg.name} = ${i}\n`;
    });
    out += `    COUNT = ${ir.messages.length}\n\n`;
  }

  // Header encode/decode
  out += `def encode_header(msg_type: int, payload_len: int) -> bytes:\n`;
  out += `    """Build a 6-byte protocol header."""\n`;
  out += `    return struct.pack("<HBHB", PROTOCOL_MAGIC, PROTOCOL_VERSION, msg_type, payload_len)\n\n`;

  out += `def decode_header(data: bytes) -> tuple:\n`;
  out += `    """Decode header. Returns (magic, version, msg_type, payload_len)."""\n`;
  out += `    if len(data) < PROTOCOL_HEADER_SIZE:\n`;
  out += `        raise ValueError("Buffer too small for header")\n`;
  out += `    magic, version, msg_type, payload_len = struct.unpack("<HBHB", data[:PROTOCOL_HEADER_SIZE])\n`;
  out += `    if magic != PROTOCOL_MAGIC:\n`;
  out += `        raise ValueError(f"Bad magic: 0x{magic:04X} (expected 0x{PROTOCOL_MAGIC:04X})")\n`;
  out += `    if version != PROTOCOL_VERSION:\n`;
  out += `        raise ValueError(f"Version mismatch: {version} (expected {PROTOCOL_VERSION})")\n`;
  out += `    return magic, version, msg_type, payload_len\n\n`;

  // User enums
  for (const en of ir.enums) {
    out += `class ${en.name}:\n`;
    for (const [key, val] of Object.entries(en.values)) {
      out += `    ${key} = ${val}\n`;
    }
    out += '\n';
  }

  // Message classes
  const buildClass = (name: string, fieldIds: string[], msgIndex: number | null) => {
    const fields = fieldIds.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    let cls = `class ${name}:\n`;
    cls += `    """${name} protocol message"""\n\n`;
    cls += `    def __init__(self):\n`;
    for (const f of fields) {
      if (f.type === 'string') cls += `        self.${f.name} = ""\n`;
      else if (f.type === 'float' || f.type === 'double') cls += `        self.${f.name} = 0.0\n`;
      else if (f.type === 'bool') cls += `        self.${f.name} = False\n`;
      else if (f.type === 'bytes' || f.type === 'array') cls += `        self.${f.name} = b'\\x00' * ${(f.length || 1)}\n`;
      else if (f.type === 'enum') {
        const en = findEnumForField(f, ir);
        cls += `        self.${f.name} = ${en ? en.name + '.' + Object.keys(en.values)[0] : '0'}\n`;
      }
      else cls += `        self.${f.name} = 0\n`;
    }
    cls += '\n';

    const formatMap: Record<string, string> = {
      uint8: 'B', int8: 'b', uint16: 'H', int16: 'h',
      uint32: 'I', int32: 'i', uint64: 'Q', int64: 'q',
      float: 'f', double: 'd', bool: '?',
    };

    const packParts = fields.map((f) => f.type === 'enum' ? 'B' : formatMap[f.type] || 's');
    const fmt = '<' + packParts.join('');
    const fieldNames = fields.map((f) => f.name);

    cls += `    def encode_payload(self) -> bytes:\n`;
    cls += `        """Encode payload only (no header)."""\n`;
    cls += `        return struct.pack("${fmt}"`;
    for (const f of fieldNames) cls += `, self.${f}`;
    cls += `)\n\n`;

    cls += `    @classmethod\n`;
    cls += `    def decode_payload(cls, data: bytes) -> "${name}":\n`;
    cls += `        """Decode payload only (no header)."""\n`;
    cls += `        if len(data) < ${name}.payload_size():\n`;
    cls += `            raise ValueError(f"Payload too small: {len(data)} < ${name}.payload_size()")\n`;
    cls += `        msg = cls()\n`;
    cls += `        values = struct.unpack("${fmt}", data)\n`;
    for (let i = 0; i < fieldNames.length; i++) {
      cls += `        msg.${fieldNames[i]} = values[${i}]\n`;
    }
    cls += `        return msg\n\n`;

    const sz = totalSize(fields, ir);
    cls += `    @staticmethod\n`;
    cls += `    def payload_size() -> int:\n`;
    cls += `        return ${sz}\n\n`;

    if (msgIndex !== null) {
      cls += `    def encode(self) -> bytes:\n`;
      cls += `        """Encode complete packet with header."""\n`;
      cls += `        payload = self.encode_payload()\n`;
      cls += `        return encode_header(MsgType.${name}, len(payload)) + payload\n\n`;
    }

    return cls;
  };

  for (const st of ir.structs) out += buildClass(st.name, st.fields, null);
  for (let i = 0; i < ir.messages.length; i++) {
    out += buildClass(ir.messages[i].name, ir.messages[i].fields, i);
  }

  // Generic decode
  if (ir.messages.length > 0) {
    out += `def decode_packet(data: bytes) -> tuple:\n`;
    out += `    """\n`;
    out += `    Decode any packet. Returns (msg_type, message_object).\n`;
    out += `    Raises ValueError on invalid header.\n`;
    out += `    """\n`;
    out += `    _, _, msg_type, payload_len = decode_header(data)\n`;
    out += `    payload = data[PROTOCOL_HEADER_SIZE:PROTOCOL_HEADER_SIZE + payload_len]\n`;
    out += `    dispatch = {\n`;
    ir.messages.forEach((msg, i) => {
      out += `        ${i}: ${msg.name}.decode_payload,\n`;
    });
    out += `    }\n`;
    out += `    decoder = dispatch.get(msg_type)\n`;
    out += `    if decoder is None:\n`;
    out += `        raise ValueError(f"Unknown msg_type: {msg_type}")\n`;
    out += `    return msg_type, decoder(payload)\n\n`;
  }

  return out;
}

function rustType(field: ProtocolField): string {
  const map: Record<string, string> = {
    uint8: 'u8', int8: 'i8', uint16: 'u16', int16: 'i16',
    uint32: 'u32', int32: 'i32', uint64: 'u64', int64: 'i64',
    float: 'f32', double: 'f64', bool: 'bool',
    string: 'String', bytes: 'Vec<u8>', array: 'Vec<u8>',
  };
  return map[field.type] || 'Vec<u8>';
}

export function generateRust(ir: ProtocolIR): string {
  let out = `use serde::{Deserialize, Serialize};\nuse std::io;\n\n`;

  out += `pub const PROTOCOL_MAGIC: u16 = 0xAA55;\n`;
  out += `pub const PROTOCOL_VERSION: u8 = 1;\n`;
  out += `pub const PROTOCOL_HEADER_SIZE: usize = 6;\n\n`;

  // MsgType enum
  if (ir.messages.length > 0) {
    out += `#[derive(Debug, Clone, Copy, PartialEq, Eq)]\n`;
    out += `#[repr(u8)]\n`;
    out += `pub enum MsgType {\n`;
    ir.messages.forEach((msg, i) => {
      out += `    ${msg.name} = ${i},\n`;
    });
    out += `}\n\n`;
    out += `impl MsgType {\n`;
    out += `    pub fn from_u8(v: u8) -> Option<Self> {\n`;
    out += `        match v {\n`;
    ir.messages.forEach((msg, i) => {
      out += `            ${i} => Some(MsgType::${msg.name}),\n`;
    });
    out += `            _ => None,\n`;
    out += `        }\n`;
    out += `    }\n`;
    out += `}\n\n`;
  }

  // ProtocolHeader
  out += `#[derive(Debug, Clone, Copy)]\n`;
  out += `pub struct ProtocolHeader {\n`;
  out += `    pub magic: u16,\n`;
  out += `    pub version: u8,\n`;
  out += `    pub msg_type: u8,\n`;
  out += `    pub payload_len: u16,\n`;
  out += `}\n\n`;

  out += `impl ProtocolHeader {\n`;
  out += `    pub fn new(msg_type: u8, payload_len: u16) -> Self {\n`;
  out += `        Self { magic: PROTOCOL_MAGIC, version: PROTOCOL_VERSION, msg_type, payload_len }\n`;
  out += `    }\n\n`;
  out += `    pub fn encode(&self, buf: &mut Vec<u8>) {\n`;
  out += `        buf.extend_from_slice(&self.magic.to_le_bytes());\n`;
  out += `        buf.push(self.version);\n`;
  out += `        buf.push(self.msg_type);\n`;
  out += `        buf.extend_from_slice(&self.payload_len.to_le_bytes());\n`;
  out += `    }\n\n`;
  out += `    pub fn decode(buf: &[u8]) -> io::Result<Self> {\n`;
  out += `        if buf.len() < PROTOCOL_HEADER_SIZE {\n`;
  out += `            return Err(io::Error::new(io::ErrorKind::InvalidData, "buffer too small for header"));\n`;
  out += `        }\n`;
  out += `        let magic = u16::from_le_bytes([buf[0], buf[1]]);\n`;
  out += `        if magic != PROTOCOL_MAGIC {\n`;
  out += `            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("bad magic: 0x{:04X}", magic)));\n`;
  out += `        }\n`;
  out += `        let version = buf[2];\n`;
  out += `        if version != PROTOCOL_VERSION {\n`;
  out += `            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("version mismatch: {} (expected {})", version, PROTOCOL_VERSION)));\n`;
  out += `        }\n`;
  out += `        let msg_type = buf[3];\n`;
  out += `        let payload_len = u16::from_le_bytes([buf[4], buf[5]]);\n`;
  out += `        Ok(Self { magic, version, msg_type, payload_len })\n`;
  out += `    }\n`;
  out += `}\n\n`;

  // User enums
  for (const en of ir.enums) {
    out += `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\n`;
    out += `#[repr(u8)]\n`;
    out += `pub enum ${en.name} {\n`;
    for (const [key, val] of Object.entries(en.values)) {
      out += `    #[serde(rename = "${key}")]\n`;
      out += `    ${key} = ${val},\n`;
    }
    out += `}\n\n`;
    out += `impl ${en.name} {\n`;
    out += `    pub fn from_u8(v: u8) -> Option<Self> {\n`;
    out += `        match v {\n`;
    for (const [key, val] of Object.entries(en.values)) {
      out += `            ${val} => Some(${en.name}::${key}),\n`;
    }
    out += `            _ => None,\n`;
    out += `        }\n`;
    out += `    }\n`;
    out += `}\n\n`;
  }

  // Structs (no header)
  for (const st of ir.structs) {
    const fields = st.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    out += `#[derive(Debug, Clone, Serialize, Deserialize)]\n`;
    out += `pub struct ${st.name} {\n`;
    for (const f of fields) {
      if (f.type === 'enum') {
        const en = findEnumForField(f, ir);
        out += `    pub ${f.name}: ${en ? en.name : 'u8'},\n`;
      } else {
        out += `    pub ${f.name}: ${rustType(f)},\n`;
      }
    }
    out += `}\n\n`;
  }

  // Messages (with header support)
  for (let idx = 0; idx < ir.messages.length; idx++) {
    const msg = ir.messages[idx];
    const fields = msg.fields.map((fid) => ir.fields.find((f) => f.id === fid)).filter(Boolean) as ProtocolField[];
    const sz = totalSize(fields, ir);

    out += `#[derive(Debug, Clone, Serialize, Deserialize)]\n`;
    out += `pub struct ${msg.name} {\n`;
    for (const f of fields) {
      if (f.type === 'enum') {
        const en = findEnumForField(f, ir);
        out += `    pub ${f.name}: ${en ? en.name : 'u8'},\n`;
      } else {
        out += `    pub ${f.name}: ${rustType(f)},\n`;
      }
    }
    out += `}\n\n`;

    out += `impl ${msg.name} {\n`;
    out += `    pub const fn payload_size() -> usize { ${sz} }\n\n`;

    // encode_payload
    out += `    pub fn encode_payload(&self, buf: &mut Vec<u8>) {\n`;
    out += `        buf.reserve(Self::payload_size());\n`;
    for (const f of fields) {
      if (f.type === 'enum') {
        out += `        buf.push(self.${f.name} as u8);\n`;
      } else if (f.type === 'float') {
        out += `        buf.extend_from_slice(&self.${f.name}.to_le_bytes());\n`;
      } else if (f.type === 'double') {
        out += `        buf.extend_from_slice(&self.${f.name}.to_le_bytes());\n`;
      } else if (f.type === 'bool') {
        out += `        buf.push(if self.${f.name} { 1 } else { 0 });\n`;
      } else if (f.type === 'string') {
        const ws = getFieldWireSize(f, ir);
        out += `        let bytes = self.${f.name}.as_bytes();\n`;
        out += `        let mut padded = [0u8; ${ws}];\n`;
        out += `        let len = bytes.len().min(${ws});\n`;
        out += `        padded[..len].copy_from_slice(&bytes[..len]);\n`;
        out += `        buf.extend_from_slice(&padded);\n`;
      } else if (f.type === 'bytes' || f.type === 'array') {
        const ws = getFieldWireSize(f, ir);
        out += `        let mut padded = [0u8; ${ws}];\n`;
        out += `        let len = self.${f.name}.len().min(${ws});\n`;
        out += `        padded[..len].copy_from_slice(&self.${f.name}[..len]);\n`;
        out += `        buf.extend_from_slice(&padded);\n`;
      } else {
        out += `        buf.extend_from_slice(&(self.${f.name} as ${rustType(f)}).to_le_bytes());\n`;
      }
    }
    out += `    }\n\n`;

    // decode_payload
    out += `    pub fn decode_payload(buf: &[u8]) -> io::Result<Self> {\n`;
    out += `        if buf.len() < Self::payload_size() {\n`;
    out += `            return Err(io::Error::new(io::ErrorKind::InvalidData, "payload too small"));\n`;
    out += `        }\n`;
    out += `        let mut pos = 0;\n`;
    for (const f of fields) {
      const ws = getFieldWireSize(f, ir);
      if (f.type === 'enum') {
        const en = findEnumForField(f, ir);
        if (en) {
          out += `        let ${f.name} = ${en.name}::from_u8(buf[pos]).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid ${en.name} value"))?;\n`;
        } else {
          out += `        let ${f.name} = buf[pos];\n`;
        }
        out += `        pos += ${ws};\n`;
      } else if (f.type === 'float') {
        out += `        let ${f.name} = f32::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());\n`;
        out += `        pos += ${ws};\n`;
      } else if (f.type === 'double') {
        out += `        let ${f.name} = f64::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());\n`;
        out += `        pos += ${ws};\n`;
      } else if (f.type === 'bool') {
        out += `        let ${f.name} = buf[pos] != 0;\n`;
        out += `        pos += 1;\n`;
      } else if (f.type === 'string') {
        out += `        let ${f.name} = String::from_utf8_lossy(&buf[pos..pos + ${ws}]).trim_end_matches('\\0').to_string();\n`;
        out += `        pos += ${ws};\n`;
      } else if (f.type === 'bytes' || f.type === 'array') {
        out += `        let ${f.name} = buf[pos..pos + ${ws}].to_vec();\n`;
        out += `        pos += ${ws};\n`;
      } else if (ws === 1) {
        out += `        let ${f.name} = buf[pos];\n`;
        out += `        pos += 1;\n`;
      } else {
        out += `        let ${f.name} = ${rustType(f)}::from_le_bytes(buf[pos..pos + ${ws}].try_into().unwrap());\n`;
        out += `        pos += ${ws};\n`;
      }
    }
    out += `        Ok(Self { ${fields.map((f) => f.name).join(', ')} })\n`;
    out += `    }\n\n`;

    // encode (full packet with header)
    out += `    pub fn encode(&self) -> Vec<u8> {\n`;
    out += `        let mut buf = Vec::with_capacity(PROTOCOL_HEADER_SIZE + Self::payload_size());\n`;
    out += `        let header = ProtocolHeader::new(${idx} as u8, Self::payload_size() as u16);\n`;
    out += `        header.encode(&mut buf);\n`;
    out += `        self.encode_payload(&mut buf);\n`;
    out += `        buf\n`;
    out += `    }\n\n`;

    // decode (full packet)
    out += `    pub fn decode(buf: &[u8]) -> io::Result<(ProtocolHeader, Self)> {\n`;
    out += `        let header = ProtocolHeader::decode(buf)?;\n`;
    out += `        if (header.payload_len as usize) != Self::payload_size() {\n`;
    out += `            return Err(io::Error::new(io::ErrorKind::InvalidData, "payload size mismatch"));\n`;
    out += `        }\n`;
    out += `        let msg = Self::decode_payload(&buf[PROTOCOL_HEADER_SIZE..])?;\n`;
    out += `        Ok((header, msg))\n`;
    out += `    }\n`;
    out += `}\n\n`;
  }

  // Generic decode function
  if (ir.messages.length > 0) {
    out += `pub fn decode_packet(buf: &[u8]) -> io::Result<(ProtocolHeader, Vec<u8>)> {\n`;
    out += `    let header = ProtocolHeader::decode(buf)?;\n`;
    out += `    let payload = buf[PROTOCOL_HEADER_SIZE..PROTOCOL_HEADER_SIZE + header.payload_len as usize].to_vec();\n`;
    out += `    Ok((header, payload))\n`;
    out += `}\n\n`;
  }

  return out;
}
