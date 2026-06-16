import type { ProtocolIR, ProtocolField, ProtocolModules, Endianness } from '@/types/protocol';
import {
  getFieldWireSize, totalSize, findEnumForField,
  resolveModules, isFixedField,
  computeOptionalBitmaskSize, getHeaderSize,
  getStructPackPrefix,
} from './shared';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Return the struct.pack format character for a field type. */
function getStructPackFormatChar(field: ProtocolField): string {
  switch (field.type) {
    case 'uint8':   return 'B';
    case 'int8':    return 'b';
    case 'uint16':  return 'H';
    case 'int16':   return 'h';
    case 'uint32':  return 'I';
    case 'int32':   return 'i';
    case 'uint64':  return 'Q';
    case 'int64':   return 'q';
    case 'float':   return 'f';
    case 'double':  return 'd';
    case 'bool':    return '?';
    case 'char':    return 'B';
    case 'enum':    return 'B';
    case 'string':  return `${field.length || 256}s`;
    case 'bytes':
    case 'array':   return `${field.length || 1}s`;
    default:        return 'B';
  }
}

/** Build a combined struct.pack format string for a set of fixed-size fields. */
function buildStructFormat(fields: ProtocolField[]): string {
  const chars = fields.map(getStructPackFormatChar);
  return '<' + chars.join('');
}

/** True if any field is variable-length (vstring/vbytes/string/bytes/array). */
function hasVariableFields(fields: ProtocolField[]): boolean {
  return fields.some((f) => !isFixedField(f.type));
}

/** True if any field is marked optional. */
function hasOptionalFields(fields: ProtocolField[]): boolean {
  return fields.some((f) => f.optional);
}

// ────────────────────────────────────────────────────────────────────────────
// Template functions — each returns a string of Python code
// ────────────────────────────────────────────────────────────────────────────

// ── 1. genPyImports ─────────────────────────────────────────────────────────

function genPyImports(): string {
  return 'import struct\nimport math\n\n';
}

// ── 2. genPyConstants ──────────────────────────────────────────────────────

function genPyConstants(modules: ProtocolModules): string {
  const lines: string[] = [];
  lines.push('PROTOCOL_MAGIC = 0xAA55');
  lines.push('PROTOCOL_VERSION = 1');
  lines.push(`PROTOCOL_HEADER_SIZE = ${getHeaderSize(modules)}`);
  if (modules.crc) {
    lines.push('PROTOCOL_CRC_SIZE = 2');
  }
  return lines.join('\n') + '\n\n';
}

// ── 3. genPyCrcFunction ────────────────────────────────────────────────────

function genPyCrcFunction(): string {
  let out = 'def _crc16(data: bytes) -> int:\n';
  out += '    """Compute CRC16-CCITT checksum."""\n';
  out += '    crc = 0xFFFF\n';
  out += '    for byte in data:\n';
  out += '        crc ^= byte << 8\n';
  out += '        for _ in range(8):\n';
  out += '            if crc & 0x8000:\n';
  out += '                crc = (crc << 1) ^ 0x1021\n';
  out += '            else:\n';
  out += '                crc <<= 1\n';
  out += '        crc &= 0xFFFF\n';
  out += '    return crc\n\n';
  return out;
}

// ── 4. genPyMsgTypeClass ──────────────────────────────────────────────────

function genPyMsgTypeClass(messages: ProtocolIR['messages']): string {
  if (messages.length === 0) return '';
  let out = 'class MsgType:\n';
  for (let i = 0; i < messages.length; i++) {
    out += `    ${messages[i].name} = ${i}\n`;
  }
  out += '    COUNT = ' + messages.length + '\n\n';
  return out;
}

// ── 5. genPyHeaderFunctions ────────────────────────────────────────────────

function genPyHeaderFunctions(modules: ProtocolModules, endian: Endianness): string {
  const hasVersion = modules.versionField;
  const p = getStructPackPrefix(endian);
  let out: string;

  // Header always includes magic(2) + msg_type(1) + payload_len(2)
  // L3+ adds version(1) between magic and msg_type

  if (hasVersion) {
    out = 'def encode_header(msg_type: int, payload_len: int) -> bytes:\n';
    out += `    return struct.pack("${p}HBHB", PROTOCOL_MAGIC, PROTOCOL_VERSION, msg_type, payload_len)\n\n`;

    out += 'def decode_header(data: bytes) -> tuple:\n';
    out += '    """Decode header. Returns (magic, version, msg_type, payload_len)."""\n';
    out += '    if len(data) < PROTOCOL_HEADER_SIZE:\n';
    out += '        raise ValueError("Buffer too small for header")\n';
    out += `    magic, version, msg_type, payload_len = struct.unpack("${p}HBHB", data[:PROTOCOL_HEADER_SIZE])\n`;
    out += '    if magic != PROTOCOL_MAGIC:\n';
    out += '        raise ValueError(f"Bad magic: 0x{magic:04X} (expected 0x{PROTOCOL_MAGIC:04X})")\n';
    out += '    if version != PROTOCOL_VERSION:\n';
    out += '        raise ValueError(f"Version mismatch: {version} (expected {PROTOCOL_VERSION})")\n';
    out += '    return magic, version, msg_type, payload_len\n\n';
  } else {
    out = 'def encode_header(msg_type: int, payload_len: int) -> bytes:\n';
    out += `    return struct.pack("${p}HBH", PROTOCOL_MAGIC, msg_type, payload_len)\n\n`;

    out += 'def decode_header(data: bytes) -> tuple:\n';
    out += '    """Decode header. Returns (magic, msg_type, payload_len)."""\n';
    out += '    if len(data) < PROTOCOL_HEADER_SIZE:\n';
    out += '        raise ValueError("Buffer too small for header")\n';
    out += `    magic, msg_type, payload_len = struct.unpack("${p}HBH", data[:PROTOCOL_HEADER_SIZE])\n`;
    out += '    if magic != PROTOCOL_MAGIC:\n';
    out += '        raise ValueError(f"Bad magic: 0x{magic:04X} (expected 0x{PROTOCOL_MAGIC:04X})")\n';
    out += '    return magic, msg_type, payload_len\n\n';
  }

  return out;
}

// ── 6. genPyEnumClass ──────────────────────────────────────────────────────

function genPyEnumClass(en: ProtocolIR['enums'][number]): string {
  let out = `class ${en.name}:\n`;
  for (const [key, val] of Object.entries(en.values)) {
    out += `    ${key} = ${val}\n`;
  }
  out += '\n';
  return out;
}

// ── 7. genPyClass — main orchestrator for one message/struct class ─────────

function genPyClass(
  name: string,
  fields: ProtocolField[],
  msgIndex: number | null,
  modules: ProtocolModules,
  ir: ProtocolIR,
): string {
  const parts: string[] = [];

  parts.push(`class ${name}:`);
  parts.push(`    """${name} protocol message."""`);
  parts.push('');

  // ── __init__ ──────────────────────────────────────────────────────────
  if (modules.optionalFields && hasOptionalFields(fields) && !modules.tlv) {
    parts.push(genPyOptionalInit(fields, ir));
  } else {
    parts.push(genPyInit(fields, ir));
  }

  // ── validate() for L2+ ────────────────────────────────────────────────
  if (modules.validation || modules.rangeChecks) {
    parts.push(genPyValidate(fields));
  }

  // ── Encode / decode payload (three paths) ────────────────────────────
  if (modules.tlv) {
    parts.push(genPyTlvEncode(fields, ir));
    parts.push(genPyTlvDecode(name, fields, ir));
  } else if (hasVariableFields(fields)) {
    parts.push(genPyVarEncode(fields));
    parts.push(genPyVarDecode(fields));
  } else {
    parts.push(genPyStructEncode(fields));
    parts.push(genPyStructDecode(fields, ir));
  }

  // ── payload_size() ───────────────────────────────────────────────────
  parts.push(genPyPayloadSize(fields, modules, ir));

  // ── encode() — messages only (with header) ─────────────────────────
  if (msgIndex !== null && modules.header) {
    parts.push(genPyEncode(name, msgIndex, modules));
  }

  // ── decode() classmethod — messages only ──────────────────────────
  if (msgIndex !== null && modules.header) {
    parts.push(genPyDecode(name, modules));
  }

  return parts.join('\n') + '\n';
}

// ── __init__ (no optional tracking) ────────────────────────────────────────

function genPyInit(fields: ProtocolField[], ir: ProtocolIR): string {
  let out = '    def __init__(self):\n';
  for (const f of fields) {
    if (f.type === 'string') {
      out += `        self.${f.name} = ""\n`;
    } else if (f.type === 'float' || f.type === 'double') {
      out += `        self.${f.name} = 0.0\n`;
    } else if (f.type === 'bool') {
      out += `        self.${f.name} = False\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      out += `        self.${f.name} = b'\\x00' * ${f.length || 1}\n`;
    } else if (f.type === 'vstring') {
      out += `        self.${f.name} = ""\n`;
    } else if (f.type === 'vbytes') {
      out += `        self.${f.name} = b""\n`;
    } else if (f.type === 'enum') {
      const en = findEnumForField(f, ir);
      const defaultVal = en ? `${en.name}.${Object.keys(en.values)[0]}` : '0';
      out += `        self.${f.name} = ${defaultVal}\n`;
    } else {
      out += `        self.${f.name} = 0\n`;
    }
  }
  out += '\n';
  return out;
}

// ── validate() — range checks for L2+ ─────────────────────────────────────

function genPyValidate(fields: ProtocolField[]): string {
  const checked = fields.filter((f) => f.minValue !== undefined && f.maxValue !== undefined);
  if (checked.length === 0) {
    return '    def validate(self) -> None:\n        """No range checks defined."""\n        pass\n\n';
  }
  let out = '    def validate(self) -> None:\n';
  out += '        """Validate field ranges."""\n';
  for (const f of checked) {
    out += `        if not (${f.minValue!} <= self.${f.name} <= ${f.maxValue!}):\n`;
    out += `            raise ValueError(f"${f.name} value {self.${f.name}} out of range [${f.minValue!}, ${f.maxValue!}]")\n`;
  }
  out += '\n';
  return out;
}

// ── payload_size() static method ──────────────────────────────────────────

function genPyPayloadSize(fields: ProtocolField[], modules: ProtocolModules, ir: ProtocolIR): string {
  let size: number;
  if (modules.tlv) {
    size = totalSize(fields, ir) + 3 * fields.length;
  } else {
    size = totalSize(fields, ir);
    if (modules.optionalFields && hasOptionalFields(fields) && !modules.tlv) {
      size += computeOptionalBitmaskSize(fields);
    }
  }
  let out = '    @staticmethod\n';
  out += `    def payload_size() -> int:\n`;
  out += `        return ${size}\n\n`;
  return out;
}

// ── 8. genPyTlvEncode ─────────────────────────────────────────────────────

function genPyTlvEncode(fields: ProtocolField[], ir: ProtocolIR): string {
  let out = '    def encode_payload(self) -> bytes:\n';
  out += '        """Encode payload as TLV entries."""\n';
  out += '        buf = b""\n';

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const tag = f.fieldTag ?? i;
    const nm = f.name;

    if (f.type === 'vstring') {
      out += `        raw = self.${nm}.encode("utf-8") if isinstance(self.${nm}, str) else self.${nm}\n`;
      out += `        raw_len = len(raw)\n`;
      out += `        buf += struct.pack("<BH", ${tag}, raw_len + 2)\n`;
      out += `        buf += struct.pack("<H", raw_len) + raw\n`;
    } else if (f.type === 'vbytes') {
      out += `        raw_len = len(self.${nm})\n`;
      out += `        buf += struct.pack("<BH", ${tag}, raw_len + 2)\n`;
      out += `        buf += struct.pack("<H", raw_len) + self.${nm}\n`;
    } else if (f.type === 'string') {
      const ws = f.length || 256;
      out += `        raw = self.${nm}.encode("utf-8") if isinstance(self.${nm}, str) else self.${nm}\n`;
      out += `        padded = raw.ljust(${ws}, b'\\x00')[:${ws}]\n`;
      out += `        buf += struct.pack("<BH", ${tag}, ${ws}) + padded\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      const ws = f.length || 1;
      out += `        padded = self.${nm}[:${ws}].ljust(${ws}, b'\\x00')\n`;
      out += `        buf += struct.pack("<BH", ${tag}, ${ws}) + padded\n`;
    } else if (f.type === 'bool') {
      out += `        buf += struct.pack("<BHB", ${tag}, 1, 1 if self.${nm} else 0)\n`;
    } else if (f.type === 'enum') {
      out += `        buf += struct.pack("<BHB", ${tag}, 1, self.${nm})\n`;
    } else {
      const ch = getStructPackFormatChar(f);
      const ws = getFieldWireSize(f, ir);
      out += `        buf += struct.pack("<BH${ch}", ${tag}, ${ws}, self.${nm})\n`;
    }
  }

  out += '        return buf\n\n';
  return out;
}

// ── 9. genPyTlvDecode ─────────────────────────────────────────────────────

function genPyTlvDecode(name: string, fields: ProtocolField[], ir: ProtocolIR): string {
  let out = `    @classmethod\n`;
  out += `    def decode_payload(cls, data: bytes) -> "${name}":\n`;
  out += '        """Decode TLV entries."""\n';
  out += '        msg = cls()\n';
  out += '        offset = 0\n';
  out += '        while offset < len(data):\n';
  out += '            if offset + 3 > len(data):\n';
  out += '                raise ValueError("Truncated TLV entry")\n';
  out += '            tag, field_len = struct.unpack("<BH", data[offset:offset + 3])\n';
  out += '            offset += 3\n';
  out += '            if offset + field_len > len(data):\n';
  out += '                raise ValueError("TLV value truncated")\n';

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const tag = f.fieldTag ?? i;
    const nm = f.name;

    const keyword = i === 0 ? 'if' : 'elif';
    out += `            ${keyword} tag == ${tag}:  # ${nm}\n`;

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      out += `                vlen = struct.unpack("<H", data[offset:offset + 2])[0]\n`;
      out += `                if vlen > ${cap}:\n`;
      out += `                    vlen = ${cap}\n`;
      out += `                offset += 2\n`;
      out += `                msg.${nm} = data[offset:offset + vlen].decode("utf-8", errors="replace")\n`;
      out += `                offset += vlen\n`;
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      out += `                vlen = struct.unpack("<H", data[offset:offset + 2])[0]\n`;
      out += `                if vlen > ${cap}:\n`;
      out += `                    vlen = ${cap}\n`;
      out += `                offset += 2\n`;
      out += `                msg.${nm} = data[offset:offset + vlen]\n`;
      out += `                offset += vlen\n`;
    } else if (f.type === 'bool') {
      out += `                msg.${nm} = data[offset] != 0\n`;
      out += '                offset += 1\n';
    } else if (f.type === 'enum') {
      out += `                msg.${nm} = data[offset]\n`;
      out += '                offset += 1\n';
    } else if (f.type === 'string') {
      const ws = f.length || 256;
      out += `                msg.${nm} = data[offset:offset + ${ws}].rstrip(b'\\x00').decode("utf-8", errors="replace")\n`;
      out += `                offset += ${ws}\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      const ws = f.length || 1;
      out += `                msg.${nm} = data[offset:offset + ${ws}]\n`;
      out += `                offset += ${ws}\n`;
    } else {
      const ch = getStructPackFormatChar(f);
      const ws = getFieldWireSize(f, ir);
      out += `                msg.${nm} = struct.unpack("<${ch}", data[offset:offset + ${ws}])[0]\n`;
      out += `                offset += ${ws}\n`;
    }
  }

  out += '            else:\n';
  out += '                # skip unknown tag (forward compatibility)\n';
  out += '                offset += field_len\n';
  out += '        return msg\n\n';
  return out;
}

// ── 10. genPyVarEncode ────────────────────────────────────────────────────

function genPyVarEncode(fields: ProtocolField[]): string {
  let out = '    def encode_payload(self) -> bytes:\n';
  out += '        """Encode payload manually (includes variable-length fields)."""\n';
  out += '        buf = b""\n';

  // Presence bitmask for optional fields (non-TLV)
  const optionalFields = fields.filter((f) => f.optional);
  if (optionalFields.length > 0) {
    const maskSize = Math.max(1, Math.ceil(optionalFields.length / 8));
    out += '        # presence bitmask\n';
    out += '        mask = 0\n';
    for (let i = 0; i < optionalFields.length; i++) {
      out += `        if self.${optionalFields[i].name}:\n`;
      out += `            mask |= 1 << ${i}\n`;
    }
    if (maskSize === 1) {
      out += '        buf += struct.pack("<B", mask)\n';
    } else if (maskSize === 2) {
      out += '        buf += struct.pack("<H", mask)\n';
    } else {
      out += '        buf += struct.pack("<I", mask)\n';
    }
  }

  for (const f of fields) {
    const nm = f.name;

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      out += `        raw = self.${nm}.encode("utf-8") if isinstance(self.${nm}, str) else self.${nm}\n`;
      out += `        raw = raw[:${cap}]\n`;
      out += `        buf += struct.pack("<H", len(raw)) + raw\n`;
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      out += `        raw = self.${nm}[:${cap}]\n`;
      out += `        buf += struct.pack("<H", len(raw)) + raw\n`;
    } else if (f.type === 'string') {
      const ws = f.length || 256;
      out += `        raw = self.${nm}.encode("utf-8") if isinstance(self.${nm}, str) else self.${nm}\n`;
      out += `        raw = raw.ljust(${ws}, b'\\x00')[:${ws}]\n`;
      out += `        buf += raw\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      const ws = f.length || 1;
      out += `        raw = self.${nm}[:${ws}].ljust(${ws}, b'\\x00')\n`;
      out += `        buf += raw\n`;
    } else if (f.type === 'bool') {
      out += `        buf += struct.pack("<B", 1 if self.${nm} else 0)\n`;
    } else if (f.type === 'enum') {
      out += `        buf += struct.pack("<B", self.${nm})\n`;
    } else {
      const ch = getStructPackFormatChar(f);
      out += `        buf += struct.pack("<${ch}", self.${nm})\n`;
    }
  }

  out += '        return buf\n\n';
  return out;
}

// ── 11. genPyVarDecode ────────────────────────────────────────────────────

function genPyVarDecode(fields: ProtocolField[]): string {
  let out = '    @classmethod\n';
  out += '    def decode_payload(cls, data: bytes) -> "object":\n';
  out += '        """Decode payload manually (includes variable-length fields)."""\n';
  out += '        msg = cls()\n';
  out += '        offset = 0\n';

  // Presence bitmask for optional fields (non-TLV)
  const optionalFields = fields.filter((f) => f.optional);
  if (optionalFields.length > 0) {
    const maskSize = Math.max(1, Math.ceil(optionalFields.length / 8));
    out += '        # presence bitmask\n';
    if (maskSize === 1) {
      out += '        mask = struct.unpack("<B", data[offset:offset + 1])[0]\n';
    } else {
      out += `        mask = struct.unpack("<${maskSize === 2 ? 'H' : 'I'}", data[offset:offset + ${maskSize}])[0]\n`;
    }
    out += `        offset += ${maskSize}\n`;
  }

  for (const f of fields) {
    const nm = f.name;

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      out += `        vlen = struct.unpack("<H", data[offset:offset + 2])[0]\n`;
      out += `        if vlen > ${cap}:\n`;
      out += `            vlen = ${cap}\n`;
      out += '        offset += 2\n';
      out += `        msg.${nm} = data[offset:offset + vlen].decode("utf-8", errors="replace")\n`;
      out += '        offset += vlen\n';
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      out += `        vlen = struct.unpack("<H", data[offset:offset + 2])[0]\n`;
      out += `        if vlen > ${cap}:\n`;
      out += `            vlen = ${cap}\n`;
      out += '        offset += 2\n';
      out += `        msg.${nm} = data[offset:offset + vlen]\n`;
      out += '        offset += vlen\n';
    } else if (f.type === 'string') {
      const sz = f.length || 256;
      out += `        msg.${nm} = data[offset:offset + ${sz}].rstrip(b'\\x00').decode("utf-8", errors="replace")\n`;
      out += `        offset += ${sz}\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      const sz = f.length || 1;
      out += `        msg.${nm} = data[offset:offset + ${sz}]\n`;
      out += `        offset += ${sz}\n`;
    } else if (f.type === 'bool') {
      out += `        msg.${nm} = data[offset] != 0\n`;
      out += '        offset += 1\n';
    } else if (f.type === 'enum') {
      out += `        msg.${nm} = data[offset]\n`;
      out += '        offset += 1\n';
    } else {
      const ws = getFieldWireSize(f, {} as ProtocolIR);
      const ch = getStructPackFormatChar(f);
      out += `        msg.${nm} = struct.unpack("<${ch}", data[offset:offset + ${ws}])[0]\n`;
      out += `        offset += ${ws}\n`;
    }
  }

  out += '        return msg\n\n';
  return out;
}

// ── 12. genPyStructEncode ─────────────────────────────────────────────────

function genPyStructEncode(fields: ProtocolField[]): string {
  const fmt = buildStructFormat(fields);
  const fieldNames = fields.map((f) => f.name);

  let out = '    def encode_payload(self) -> bytes:\n';
  out += '        """Encode payload only (no header)."""\n';
  out += `        return struct.pack("${fmt}"`;
  for (const fn of fieldNames) {
    out += `, self.${fn}`;
  }
  out += ')\n\n';
  return out;
}

// ── 13. genPyStructDecode ─────────────────────────────────────────────────

function genPyStructDecode(fields: ProtocolField[], ir: ProtocolIR): string {
  const fmt = buildStructFormat(fields);
  const fieldNames = fields.map((f) => f.name);
  const paySize = fields.reduce((acc, f) => acc + getFieldWireSize(f, ir), 0);

  let out = '    @classmethod\n';
  out += '    def decode_payload(cls, data: bytes) -> "message":\n';
  out += '        """Decode payload only (no header)."""\n';
  out += `        if len(data) < ${paySize}:\n`;
  out += `            raise ValueError(f"Payload too small: {len(data)} < ${paySize}")\n`;
  out += '        msg = cls()\n';
  out += `        values = struct.unpack("${fmt}", data[:${paySize}])\n`;
  for (let i = 0; i < fieldNames.length; i++) {
    out += `        msg.${fieldNames[i]} = values[${i}]\n`;
  }
  out += '        return msg\n\n';
  return out;
}

// ── 14. genPyOptionalInit ─────────────────────────────────────────────────

function genPyOptionalInit(fields: ProtocolField[], ir: ProtocolIR): string {
  let out = '    def __init__(self):\n';
  out += '        """Initialize fields with presence tracking for optional fields."""\n';
  out += '        self.presence_bitmask = 0\n';
  for (const f of fields) {
    if (f.type === 'string') {
      out += `        self.${f.name} = ""\n`;
    } else if (f.type === 'float' || f.type === 'double') {
      out += `        self.${f.name} = 0.0\n`;
    } else if (f.type === 'bool') {
      out += `        self.${f.name} = False\n`;
    } else if (f.type === 'bytes' || f.type === 'array') {
      out += `        self.${f.name} = b'\\x00' * ${f.length || 1}\n`;
    } else if (f.type === 'vstring') {
      out += `        self.${f.name} = ""\n`;
    } else if (f.type === 'vbytes') {
      out += `        self.${f.name} = b""\n`;
    } else if (f.type === 'enum') {
      const en = findEnumForField(f, ir);
      const defaultVal = en ? `${en.name}.${Object.keys(en.values)[0]}` : '0';
      out += `        self.${f.name} = ${defaultVal}\n`;
    } else {
      out += `        self.${f.name} = 0\n`;
    }
  }
  out += '\n';
  return out;
}

// ── 15. genPyEncode — full packet encode (header + payload + CRC) ─────────

function genPyEncode(name: string, msgIndex: number, _modules: ProtocolModules): string {
  let out = '    def encode(self) -> bytes:\n';
  out += '        """Encode complete packet with header."""\n';
  out += '        payload = self.encode_payload()\n';
  out += '        pkt = encode_header(MsgType.' + name + ', len(payload)) + payload\n';

  if (modules.crc) {
    out += '        crc = _crc16(pkt)\n';
    out += '        pkt += struct.pack("<H", crc)\n';
  }

  out += '        return pkt\n\n';
  return out;
}

// ── Per-message decode classmethod ────────────────────────────────────────

function genPyDecode(name: string, _modules: ProtocolModules): string {
  let out = '    @classmethod\n';
  out += `    def decode(cls, data: bytes) -> "${name}":\n`;
  out += '        """Decode a complete packet for this message type."""\n';
  out += '        _, _, payload_len = decode_header(data)\n';
  out += '        payload = data[PROTOCOL_HEADER_SIZE:PROTOCOL_HEADER_SIZE + payload_len]\n';
  out += '        return cls.decode_payload(payload)\n\n';
  return out;
}

// ── 16. genPyDecodePacket — generic decoder dispatcher ────────────────────

function genPyDecodePacket(ir: ProtocolIR, modules: ProtocolModules): string {
  if (ir.messages.length === 0) return '';

  let out = 'def decode_packet(data: bytes) -> tuple:\n';
  out += '    """\n';
  out += '    Decode any packet. Returns (msg_type, message_object).\n';
  out += '    Raises ValueError on invalid header or CRC mismatch.\n';
  out += '    """\n';

  if (modules.crc) {
    out += '    if len(data) < PROTOCOL_HEADER_SIZE + PROTOCOL_CRC_SIZE:\n';
    out += '        raise ValueError("Packet too small")\n';
    out += '    stored_crc = struct.unpack("<H", data[-PROTOCOL_CRC_SIZE:])[0]\n';
    out += '    calc_crc = _crc16(data[:-PROTOCOL_CRC_SIZE])\n';
    out += '    if stored_crc != calc_crc:\n';
    out += '        raise ValueError(f"CRC mismatch: {stored_crc:#06x} != {calc_crc:#06x}")\n';
    out += '    data = data[:-PROTOCOL_CRC_SIZE]\n';
  }

  const hasVersion = modules.versionField;
  if (hasVersion) {
    out += '    _, _, msg_type, payload_len = decode_header(data)\n';
  } else {
    out += '    _, msg_type, payload_len = decode_header(data)\n';
  }
  out += '    payload = data[PROTOCOL_HEADER_SIZE:PROTOCOL_HEADER_SIZE + payload_len]\n';

  out += '    dispatch = {\n';
  for (let i = 0; i < ir.messages.length; i++) {
    out += `        ${i}: ${ir.messages[i].name}.decode_payload,\n`;
  }
  out += '    }\n';
  out += '    decoder = dispatch.get(msg_type)\n';
  out += '    if decoder is None:\n';
  out += '        raise ValueError(f"Unknown msg_type: {msg_type}")\n';
  out += '    return msg_type, decoder(payload)\n\n';

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Main exported orchestrator
// ────────────────────────────────────────────────────────────────────────────

export function generatePython(ir: ProtocolIR): string {
  const modules = resolveModules(ir);
  const parts: string[] = [];
  const hasHeader = modules.header;

  parts.push(genPyImports());

  if (hasHeader) {
    parts.push(genPyConstants(modules));
    if (modules.crc) {
      parts.push(genPyCrcFunction());
    }
    if (ir.messages.length > 0) {
      parts.push(genPyMsgTypeClass(ir.messages));
    }
    parts.push(genPyHeaderFunctions(modules, ir.endian));
  } else {
    // Level 0: minimal constants (no header, no CRC, no MsgType)
    parts.push('# Protocol constants\n');
    parts.push('PROTOCOL_VERSION = 1\n\n');
  }

  // Enum classes
  for (const en of ir.enums) {
    parts.push(genPyEnumClass(en));
  }

  // Struct classes (no header, no msgIndex)
  for (const st of ir.structs) {
    const fields = st.fields
      .map((fid) => ir.fields.find((f) => f.id === fid))
      .filter(Boolean) as ProtocolField[];
    parts.push(genPyClass(st.name, fields, null, modules, ir));
  }

  // Message classes (with msgIndex)
  for (let i = 0; i < ir.messages.length; i++) {
    const msg = ir.messages[i];
    const fields = msg.fields
      .map((fid) => ir.fields.find((f) => f.id === fid))
      .filter(Boolean) as ProtocolField[];
    parts.push(genPyClass(msg.name, fields, i, modules, ir));
  }

  // Generic decode_packet
  if (hasHeader && ir.messages.length > 0) {
    parts.push(genPyDecodePacket(ir, modules));
  }

  return parts.join('\n');
}
