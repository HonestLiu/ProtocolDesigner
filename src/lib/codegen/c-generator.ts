import type { ProtocolIR, ProtocolField, ProtocolEnum, ProtocolModules, Endianness } from '@/types/protocol';
import {
  resolveModules,
  getHeaderSize, computeOptionalBitmaskSize,
  getHeaderLayout,
} from './shared';

// ───── Internal helpers ──────────────────────────────────────────────────────

/** Resolve the C type name for an enum field by matching field name to enums. */
function resolveEnumName(field: ProtocolField, enums?: ProtocolEnum[]): string | null {
  if (field.type !== 'enum' || !enums || enums.length === 0) return null;
  const fieldBase = field.name
    .replace(/_?code$/, '')
    .replace(/_?type$/, '')
    .replace(/_?status$/, '');
  for (const en of enums) {
    if (en.name.toLowerCase().includes(fieldBase.toLowerCase())) return en.name;
  }
  // Fallback: match by first enum value
  for (const en of enums) {
    const firstKey = Object.keys(en.values)[0]?.toLowerCase() || '';
    if (field.name.toLowerCase().includes(firstKey.replace(/s$/, ''))) return en.name;
  }
  return enums.length === 1 ? enums[0].name : null;
}

/** Wire size for a field without needing the full IR.  Enum fields default to 1. */
function wireSize(field: ProtocolField): number {
  if (field.type === 'enum') return 1;
  const map: Record<string, number> = {
    uint8: 1, int8: 1, uint16: 2, int16: 2,
    uint32: 4, int32: 4, uint64: 8, int64: 8,
    float: 4, double: 8, bool: 1, char: 1,
  };
  if (map[field.type] !== undefined) return map[field.type];
  if (field.type === 'string') return field.length || 256;
  if (field.type === 'bytes' || field.type === 'array') return field.length || 1;
  if (field.type === 'vstring' || field.type === 'vbytes') return 2 + (field.length || 256);
  if (field.type === 'struct') return field.length || 1;
  return 1;
}

// ──── 1. Includes and Defines ───────────────────────────────────────────────

export function genCHeader(modules: ProtocolModules): string {
  const lines: string[] = [];
  lines.push('#include <stdint.h>');
  lines.push('#include <string.h>');
  lines.push('#include <stdbool.h>');
  lines.push('');

  if (modules.header) {
    lines.push('#define PROTOCOL_MAGIC      0xAA55');
    if (modules.versionField) {
      lines.push('#define PROTOCOL_VERSION    1');
    }
    lines.push(`#define PROTOCOL_HEADER_SIZE ${getHeaderSize(modules)}`);
  }
  if (modules.crc) {
    lines.push('#define PROTOCOL_CRC_SIZE   2');
  }
  lines.push('');
  return lines.join('\n');
}

// ──── 2. CRC16-CCITT Helper ─────────────────────────────────────────────────

export function genCCrcFunction(): string {
  return [
    'static inline uint16_t crc16(const uint8_t *data, size_t len) {',
    '    uint16_t crc = 0xFFFF;',
    '    for (size_t i = 0; i < len; i++) {',
    '        crc ^= (uint16_t)data[i] << 8;',
    '        for (int j = 0; j < 8; j++) {',
    '            if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;',
    '            else crc <<= 1;',
    '        }',
    '    }',
    '    return crc;',
    '}',
    '',
  ].join('\n');
}

// ──── 3. MsgType Enum ──────────────────────────────────────────────────────

export function genCMsgTypeEnum(
  allTypes: Array<{ name: string; kind: 'msg' | 'struct' }>,
): string {
  if (allTypes.length === 0) return '';
  const lines: string[] = [];
  lines.push('typedef enum {');
  for (let i = 0; i < allTypes.length; i++) {
    lines.push(`    MSG_TYPE_${allTypes[i].name} = ${i},`);
  }
  lines.push('    MSG_TYPE_COUNT');
  lines.push('} MsgType;');
  lines.push('');
  return lines.join('\n');
}

// ──── 4. ProtocolHeader Struct ─────────────────────────────────────────────

export function genCProtocolHeader(modules: ProtocolModules): string {
  const layout = getHeaderLayout(modules);
  const lines: string[] = [];
  lines.push('typedef struct __attribute__((packed)) {');
  for (const field of layout) {
    const [name, type] = field.split(':');
    const cType = type === 'u16' ? 'uint16_t' : 'uint8_t';
    lines.push(`    ${cType} ${name};`);
  }
  lines.push('} ProtocolHeader;');
  lines.push('');
  return lines.join('\n');
}

// ──── 5. Header Encode ─────────────────────────────────────────────────────

export function genCHeaderEncode(modules: ProtocolModules, endian: Endianness): string {
  const hdrSize = getHeaderSize(modules);
  const hasVersion = modules.versionField;
  const isBE = endian === 'big';
  const lines: string[] = [];

  lines.push('static inline int encode_header(uint8_t *buf, size_t buf_len, uint8_t msg_type, uint16_t payload_len) {');
  lines.push(`    if ((int)buf_len < ${hdrSize}) return -1;`);
  if (isBE) {
    lines.push('    buf[0] = (uint8_t)((PROTOCOL_MAGIC >> 8) & 0xFF);');
    lines.push('    buf[1] = (uint8_t)(PROTOCOL_MAGIC & 0xFF);');
  } else {
    lines.push('    buf[0] = (uint8_t)(PROTOCOL_MAGIC & 0xFF);');
    lines.push('    buf[1] = (uint8_t)((PROTOCOL_MAGIC >> 8) & 0xFF);');
  }
  let off = 2;
  if (hasVersion) {
    lines.push(`    buf[${off}] = PROTOCOL_VERSION;`);
    off++;
  }
  lines.push(`    buf[${off}] = msg_type;`);
  off++;
  if (isBE) {
    lines.push(`    buf[${off}]     = (uint8_t)((payload_len >> 8) & 0xFF);`);
    lines.push(`    buf[${off + 1}] = (uint8_t)(payload_len & 0xFF);`);
  } else {
    lines.push(`    buf[${off}]     = (uint8_t)(payload_len & 0xFF);`);
    lines.push(`    buf[${off + 1}] = (uint8_t)((payload_len >> 8) & 0xFF);`);
  }
  lines.push(`    return ${hdrSize};`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 6. Header Decode ─────────────────────────────────────────────────────

export function genCHeaderDecode(modules: ProtocolModules, endian: Endianness): string {
  const hdrSize = getHeaderSize(modules);
  const hasVersion = modules.versionField;
  const isBE = endian === 'big';
  const lines: string[] = [];

  lines.push('static inline int decode_header(const uint8_t *buf, size_t buf_len, ProtocolHeader *hdr) {');
  lines.push(`    if ((int)buf_len < ${hdrSize}) return -1;`);
  if (isBE) {
    lines.push('    hdr->magic = ((uint16_t)buf[0] << 8) | (uint16_t)buf[1];');
  } else {
    lines.push('    hdr->magic = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);');
  }
  let off = 2;
  if (hasVersion) {
    lines.push(`    hdr->version = buf[${off}];`);
    off++;
  }
  lines.push(`    hdr->msg_type = buf[${off}];`);
  off++;
  if (isBE) {
    lines.push(`    hdr->payload_len = ((uint16_t)buf[${off}] << 8) | (uint16_t)buf[${off + 1}];`);
  } else {
    lines.push(`    hdr->payload_len = (uint16_t)buf[${off}] | ((uint16_t)buf[${off + 1}] << 8);`);
  }
  lines.push('    if (hdr->magic != PROTOCOL_MAGIC) return -2;');
  if (hasVersion) {
    lines.push('    if (hdr->version != PROTOCOL_VERSION) return -3;');
  }
  lines.push(`    return ${hdrSize};`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 7. User Enum ─────────────────────────────────────────────────────────

export function genCUserEnum(en: ProtocolEnum): string {
  const lines: string[] = [];
  lines.push('typedef enum {');
  const entries = Object.entries(en.values);
  for (let i = 0; i < entries.length; i++) {
    const [key, val] = entries[i];
    lines.push(`    ${en.name}_${key} = ${val},`);
  }
  lines.push(`} ${en.name};`);
  lines.push('');
  return lines.join('\n');
}

// ──── 8. Struct / Message Definition ───────────────────────────────────────

export function genCStructDef(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
  enums?: ProtocolEnum[],
): string {
  const lines: string[] = [];
  lines.push('typedef struct __attribute__((packed)) {');
  for (const f of fields) {
    lines.push(`    ${genCFieldDef(f, modules, enums)};`);
  }
  lines.push(`} ${name};`);
  lines.push('');
  return lines.join('\n');
}

// ──── 9. Single Field Declaration ──────────────────────────────────────────

export function genCFieldDef(
  field: ProtocolField,
  _modules: ProtocolModules,
  enums?: ProtocolEnum[],
): string {
  if (field.type === 'enum') {
    const enumName = resolveEnumName(field, enums);
    return `${enumName || 'uint8_t'} ${field.name}`;
  }
  if (field.type === 'string') return `char ${field.name}[${field.length || 256}]`;
  if (field.type === 'bytes' || field.type === 'array') return `uint8_t ${field.name}[${field.length || 1}]`;
  if (field.type === 'vstring') {
    const cap = field.length || 256;
    return `uint16_t ${field.name}_len; char ${field.name}[${cap}]`;
  }
  if (field.type === 'vbytes') {
    const cap = field.length || 256;
    return `uint16_t ${field.name}_len; uint8_t ${field.name}[${cap}]`;
  }
  if (field.type === 'struct') {
    return `${field.structRef || 'uint8_t'} ${field.name}`;
  }
  const typeMap: Record<string, string> = {
    uint8: 'uint8_t', int8: 'int8_t',
    uint16: 'uint16_t', int16: 'int16_t',
    uint32: 'uint32_t', int32: 'int32_t',
    uint64: 'uint64_t', int64: 'int64_t',
    float: 'float', double: 'double',
    bool: 'uint8_t', char: 'char',
  };
  return `${typeMap[field.type] || 'uint8_t'} ${field.name}`;
}

// ──── 10. Encode One Field ─────────────────────────────────────────────────

export function genCEncodeField(
  field: ProtocolField,
  indent: string,
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const nm = field.name;
  const sz = wireSize(field);
  const fieldEndian = field.endian || endian;
  const isBE = fieldEndian === 'big';

  /** Generate multi-byte LE/BE write sequence for 'expr' of 'size' bytes. */
  const bytes = (size: number, expr: string, be?: boolean): string => {
    const parts: string[] = [];
    if (be) {
      for (let i = size - 1; i >= 0; i--) {
        parts.push(`buf[offset + ${size - 1 - i}] = (uint8_t)((${expr} >> ${i * 8}) & 0xFF);`);
      }
    } else {
      for (let i = 0; i < size; i++) {
        parts.push(`buf[offset + ${i}] = (uint8_t)((${expr} >> ${i * 8}) & 0xFF);`);
      }
    }
    return parts.join('\n' + indent);
  };

  // Range check before encoding (L2)
  let rangeCheck = '';
  if (modules.rangeChecks && field.minValue !== undefined && field.maxValue !== undefined) {
    rangeCheck = `${indent}if (msg->${nm} < ${field.minValue} || msg->${nm} > ${field.maxValue}) return -7;\n`;
  }

  // Bitfield packing (L4)
  if (modules.bitfields && field.bitOffset !== undefined && field.bitWidth !== undefined) {
    const totalBits = Math.max(8, field.bitOffset + field.bitWidth);
    const totalBytes = Math.ceil(totalBits / 8);
    return `${rangeCheck}${indent}{ uint${totalBytes === 4 ? 32 : totalBytes === 2 ? 16 : 8}_t packed;\n${indent}  memcpy(&packed, buf + offset, sizeof(packed));\n${indent}  packed &= ~(((1u << ${field.bitWidth}) - 1) << ${field.bitOffset});\n${indent}  packed |= (msg->${nm} & ((1u << ${field.bitWidth}) - 1)) << ${field.bitOffset};\n${indent}  memcpy(buf + offset, &packed, sizeof(packed)); }\n${indent}offset += sizeof(packed);\n`;
  }

  switch (field.type) {
    case 'uint8':
    case 'int8':
    case 'char':
      return `${rangeCheck}${indent}buf[offset] = (uint8_t)(msg->${nm});\n${indent}offset += 1;\n`;

    case 'enum':
      return `${rangeCheck}${indent}buf[offset] = (uint8_t)msg->${nm};\n${indent}offset += 1;\n`;

    case 'uint16':
    case 'int16':
      return `${rangeCheck}${indent}${bytes(2, `msg->${nm}`, isBE)}\n${indent}offset += 2;\n`;

    case 'uint32':
    case 'int32':
      return `${rangeCheck}${indent}${bytes(4, `msg->${nm}`, isBE)}\n${indent}offset += 4;\n`;

    case 'uint64':
    case 'int64':
      return `${rangeCheck}${indent}{ uint64_t v = (uint64_t)msg->${nm};\n${indent}  ${bytes(8, 'v', isBE).replace(new RegExp(`\n${indent}`, 'g'), '\n' + indent + '  ')} }\n${indent}offset += 8;\n`;

    case 'float':
      return `${rangeCheck}${indent}{ uint32_t tmp; memcpy(&tmp, &msg->${nm}, 4);\n${indent}  ${bytes(4, 'tmp', isBE)} }\n${indent}offset += 4;\n`;

    case 'double':
      return `${rangeCheck}${indent}{ uint64_t tmp; memcpy(&tmp, &msg->${nm}, 8);\n${indent}  ${bytes(8, 'tmp', isBE)} }\n${indent}offset += 8;\n`;

    case 'bool':
      return `${indent}buf[offset] = msg->${nm} ? 1 : 0;\n${indent}offset += 1;\n`;

    case 'string':
      return `${indent}memcpy(buf + offset, msg->${nm}, ${sz});\n${indent}buf[offset + ${sz} - 1] = '\\0';\n${indent}offset += ${sz};\n`;

    case 'bytes':
    case 'array':
      return `${indent}memcpy(buf + offset, msg->${nm}, ${sz});\n${indent}offset += ${sz};\n`;

    case 'struct':
      return `${rangeCheck}${indent}memcpy(buf + offset, &msg->${nm}, ${sz});\n${indent}offset += ${sz};\n`;

    case 'vstring': {
      const cap = field.length || 256;
      return `${indent}uint16_t vlen = msg->${nm}_len < ${cap} ? msg->${nm}_len : ${cap};\n${indent}buf[offset]     = (uint8_t)(vlen & 0xFF);\n${indent}buf[offset + 1] = (uint8_t)((vlen >> 8) & 0xFF);\n${indent}offset += 2;\n${indent}memcpy(buf + offset, msg->${nm}, vlen);\n${indent}offset += vlen;\n`;
    }

    case 'vbytes': {
      const cap = field.length || 256;
      return `${indent}uint16_t vlen = msg->${nm}_len < ${cap} ? msg->${nm}_len : ${cap};\n${indent}buf[offset]     = (uint8_t)(vlen & 0xFF);\n${indent}buf[offset + 1] = (uint8_t)((vlen >> 8) & 0xFF);\n${indent}offset += 2;\n${indent}memcpy(buf + offset, msg->${nm}, vlen);\n${indent}offset += vlen;\n`;
    }

    default:
      return `${indent}buf[offset] = (uint8_t)msg->${nm};\n${indent}offset += 1;\n`;
  }
}

// ──── 11. Decode One Field ─────────────────────────────────────────────────

export function genCDecodeField(
  field: ProtocolField,
  indent: string,
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const nm = field.name;
  const sz = wireSize(field);
  const fieldEndian = field.endian || endian;
  const isBE = fieldEndian === 'big';

  /** Generate multi-byte LE/BE read expression for 'size' bytes. */
  const fromBytes = (size: number, be?: boolean): string => {
    if (be) {
      const parts: string[] = [];
      for (let i = size - 1; i >= 0; i--) {
        parts.push(`((uint${size * 8}_t)buf[offset + ${size - 1 - i}] << ${i * 8})`);
      }
      return parts.join(' | ');
    }
    const parts: string[] = [];
    for (let i = 0; i < size; i++) {
      parts.push(`((uint${size * 8}_t)buf[offset + ${i}] << ${i * 8})`);
    }
    return parts.join(' | ');
  };

  // Range check after decoding (L2)
  let rangeCheck = '';
  if (modules.rangeChecks && field.minValue !== undefined && field.maxValue !== undefined) {
    rangeCheck = `${indent}if (msg->${nm} < ${field.minValue} || msg->${nm} > ${field.maxValue}) return -7;\n`;
  }

  // Bitfield extraction (L4)
  if (modules.bitfields && field.bitOffset !== undefined && field.bitWidth !== undefined) {
    const totalBits = Math.max(8, field.bitOffset + field.bitWidth);
    const totalBytes = Math.ceil(totalBits / 8);
    return `${indent}{ uint${totalBytes === 4 ? 32 : totalBytes === 2 ? 16 : 8}_t packed;\n${indent}  memcpy(&packed, buf + offset, sizeof(packed));\n${indent}  msg->${nm} = (packed >> ${field.bitOffset}) & ((1u << ${field.bitWidth}) - 1); }\n${rangeCheck}${indent}offset += sizeof(packed);\n`;
  }

  switch (field.type) {
    case 'uint8':
    case 'int8':
    case 'char':
      return `${indent}msg->${nm} = buf[offset];\n${rangeCheck}${indent}offset += 1;\n`;

    case 'enum':
      return `${indent}msg->${nm} = buf[offset];\n${rangeCheck}${indent}offset += 1;\n`;

    case 'uint16':
      return `${indent}msg->${nm} = ${fromBytes(2, isBE)};\n${rangeCheck}${indent}offset += 2;\n`;

    case 'int16':
      return `${indent}{ uint16_t t = ${fromBytes(2, isBE)}; memcpy(&msg->${nm}, &t, 2); }\n${rangeCheck}${indent}offset += 2;\n`;

    case 'uint32':
      return `${indent}msg->${nm} = ${fromBytes(4, isBE)};\n${rangeCheck}${indent}offset += 4;\n`;

    case 'int32':
      return `${indent}{ uint32_t t = ${fromBytes(4, isBE)}; memcpy(&msg->${nm}, &t, 4); }\n${rangeCheck}${indent}offset += 4;\n`;

    case 'uint64':
      return `${indent}msg->${nm} = 0;\n${indent}for (int i = 0; i < 8; i++) msg->${nm} |= ((uint64_t)buf[offset + i]) << (i * 8);\n${rangeCheck}${indent}offset += 8;\n`;

    case 'int64':
      return `${indent}{ uint64_t t = 0;\n${indent}  for (int i = 0; i < 8; i++) t |= ((uint64_t)buf[offset + i]) << (i * 8);\n${indent}  memcpy(&msg->${nm}, &t, 8); }\n${rangeCheck}${indent}offset += 8;\n`;

    case 'float':
      return `${indent}{ uint32_t t = ${fromBytes(4, isBE)}; memcpy(&msg->${nm}, &t, 4); }\n${rangeCheck}${indent}offset += 4;\n`;

    case 'double':
      return `${indent}{ uint64_t t = 0;\n${indent}  for (int i = 0; i < 8; i++) t |= ((uint64_t)buf[offset + i]) << (i * 8);\n${indent}  memcpy(&msg->${nm}, &t, 8); }\n${rangeCheck}${indent}offset += 8;\n`;

    case 'bool':
      return `${indent}msg->${nm} = buf[offset] ? 1 : 0;\n${indent}offset += 1;\n`;

    case 'string':
      return `${indent}memcpy(msg->${nm}, buf + offset, ${sz});\n${indent}msg->${nm}[${sz} - 1] = '\\0';\n${indent}offset += ${sz};\n`;

    case 'bytes':
    case 'array':
      return `${indent}memcpy(msg->${nm}, buf + offset, ${sz});\n${indent}offset += ${sz};\n`;

    case 'struct':
      return `${indent}memcpy(&msg->${nm}, buf + offset, ${sz});\n${rangeCheck}${indent}offset += ${sz};\n`;

    case 'vstring': {
      const cap = field.length || 256;
      return `${indent}msg->${nm}_len = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);\n${indent}if (msg->${nm}_len > ${cap}) msg->${nm}_len = ${cap};\n${indent}offset += 2;\n${indent}memcpy(msg->${nm}, buf + offset, msg->${nm}_len);\n${indent}if (msg->${nm}_len < ${cap}) msg->${nm}[msg->${nm}_len] = '\\0';\n${indent}offset += msg->${nm}_len;\n`;
    }

    case 'vbytes': {
      const cap = field.length || 256;
      return `${indent}msg->${nm}_len = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);\n${indent}if (msg->${nm}_len > ${cap}) msg->${nm}_len = ${cap};\n${indent}offset += 2;\n${indent}memcpy(msg->${nm}, buf + offset, msg->${nm}_len);\n${indent}offset += msg->${nm}_len;\n`;
    }

    default:
      return `${indent}msg->${nm} = buf[offset];\n${indent}offset += 1;\n`;
  }
}

// ──── 12. TLV Tag Constants ────────────────────────────────────────────────

export function genCTlvTagConstants(name: string, fields: ProtocolField[]): string {
  if (fields.length === 0) return '';
  const lines: string[] = [];
  for (let fi = 0; fi < fields.length; fi++) {
    const tag = fields[fi].fieldTag ?? fi;
    lines.push(`#define FIELD_TAG_${name}_${fields[fi].name} ${tag}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ──── 13. TLV Payload Encode ───────────────────────────────────────────────

export function genCTlvPayloadEncode(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const indent = '    ';
  const lines: string[] = [];

  lines.push(`static inline int encode_${name}_payload(uint8_t *buf, size_t buf_len, const ${name} *msg) {`);
  lines.push(`${indent}int offset = 0;`);

  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    const tag = f.fieldTag ?? fi;
    const nm = f.name;

    // Optional field in TLV mode = skip if absent; check non-zero value
    if (modules.optionalFields && f.optional) {
      if (f.type === 'vstring' || f.type === 'vbytes') {
        lines.push(`${indent}if (msg->${nm}_len > 0) {`);
      } else if (f.type === 'string') {
        lines.push(`${indent}if (msg->${nm}[0] != '\\0') {`);
      } else {
        lines.push(`${indent}if (msg->${nm} != 0) {`);
      }
    }

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`${indent}{ uint16_t vlen = msg->${nm}_len < ${cap} ? msg->${nm}_len : ${cap};`);
      lines.push(`${indent}  if (offset + 3 + 2 + (int)vlen > (int)buf_len) return -1;`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)${tag};`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((vlen + 2) & 0xFF);`);
      lines.push(`${indent}  buf[offset + 2] = (uint8_t)(((vlen + 2) >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += 3;`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)(vlen & 0xFF);`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((vlen >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += 2;`);
      lines.push(`${indent}  memcpy(buf + offset, msg->${nm}, vlen);`);
      lines.push(`${indent}  offset += vlen;`);
      lines.push(`${indent}}`);
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`${indent}{ uint16_t vlen = msg->${nm}_len < ${cap} ? msg->${nm}_len : ${cap};`);
      lines.push(`${indent}  if (offset + 3 + 2 + (int)vlen > (int)buf_len) return -1;`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)${tag};`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((vlen + 2) & 0xFF);`);
      lines.push(`${indent}  buf[offset + 2] = (uint8_t)(((vlen + 2) >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += 3;`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)(vlen & 0xFF);`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((vlen >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += 2;`);
      lines.push(`${indent}  memcpy(buf + offset, msg->${nm}, vlen);`);
      lines.push(`${indent}  offset += vlen;`);
      lines.push(`${indent}}`);
    } else {
      const ws = wireSize(f);
      lines.push(`${indent}if (offset + 3 + ${ws} > (int)buf_len) return -1;`);
      lines.push(`${indent}buf[offset]     = (uint8_t)${tag};`);
      lines.push(`${indent}buf[offset + 1] = (uint8_t)(${ws} & 0xFF);`);
      lines.push(`${indent}buf[offset + 2] = (uint8_t)((${ws} >> 8) & 0xFF);`);
      lines.push(`${indent}offset += 3;`);
      const encBody = genCEncodeField(f, indent, modules, endian);
      lines.push(encBody.trimEnd());
    }

    // Close optional block
    if (modules.optionalFields && f.optional) {
      lines.push(`${indent}}`);
    }
  }

  lines.push(`${indent}return offset;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 14. TLV Payload Decode ───────────────────────────────────────────────

export function genCTlvPayloadDecode(
  name: string,
  fields: ProtocolField[],
  _modules: ProtocolModules,
  endian: Endianness,
): string {
  const indent = '    ';
  const lines: string[] = [];

  lines.push(`static inline int decode_${name}_payload(const uint8_t *buf, size_t buf_len, ${name} *msg) {`);
  lines.push(`${indent}memset(msg, 0, sizeof(*msg));`);
  lines.push(`${indent}int offset = 0;`);
  lines.push(`${indent}while (offset < (int)buf_len) {`);
  lines.push(`${indent}    if (offset + 3 > (int)buf_len) return -8;`);
  lines.push(`${indent}    uint8_t tag = buf[offset];`);
  lines.push(`${indent}    uint16_t field_len = (uint16_t)buf[offset + 1] | ((uint16_t)buf[offset + 2] << 8);`);
  lines.push(`${indent}    offset += 3;`);
  lines.push(`${indent}    if (offset + field_len > (int)buf_len) return -8;`);
  lines.push(`${indent}    switch (tag) {`);

  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    const tag = f.fieldTag ?? fi;
    const nm = f.name;
    const ws = wireSize(f);

    lines.push(`${indent}        case ${tag}: /* ${nm} */`);

    if (f.type === 'vstring') {
      const cap = f.length || 256;
      lines.push(`${indent}            msg->${nm}_len = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);`);
      lines.push(`${indent}            if (msg->${nm}_len > ${cap}) msg->${nm}_len = ${cap};`);
      lines.push(`${indent}            offset += 2;`);
      lines.push(`${indent}            memcpy(msg->${nm}, buf + offset, msg->${nm}_len);`);
      lines.push(`${indent}            if (msg->${nm}_len < ${cap}) msg->${nm}[msg->${nm}_len] = '\\0';`);
      lines.push(`${indent}            offset += msg->${nm}_len;`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'vbytes') {
      const cap = f.length || 256;
      lines.push(`${indent}            msg->${nm}_len = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);`);
      lines.push(`${indent}            if (msg->${nm}_len > ${cap}) msg->${nm}_len = ${cap};`);
      lines.push(`${indent}            offset += 2;`);
      lines.push(`${indent}            memcpy(msg->${nm}, buf + offset, msg->${nm}_len);`);
      lines.push(`${indent}            offset += msg->${nm}_len;`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'string') {
      lines.push(`${indent}            memcpy(msg->${nm}, buf + offset, ${ws});`);
      lines.push(`${indent}            msg->${nm}[${ws} - 1] = '\\0';`);
      lines.push(`${indent}            offset += ${ws};`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'bytes' || f.type === 'array') {
      lines.push(`${indent}            if (field_len < ${ws}) { offset += field_len; break; }`);
      lines.push(`${indent}            memcpy(msg->${nm}, buf + offset, ${ws});`);
      lines.push(`${indent}            offset += ${ws};`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'enum') {
      lines.push(`${indent}            msg->${nm} = buf[offset];`);
      lines.push(`${indent}            offset += ${ws};`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'bool') {
      lines.push(`${indent}            msg->${nm} = buf[offset] ? 1 : 0;`);
      lines.push(`${indent}            offset += 1;`);
      lines.push(`${indent}            break;`);
    } else if (f.type === 'struct') {
      lines.push(`${indent}            memcpy(&msg->${nm}, buf + offset, ${ws});`);
      lines.push(`${indent}            offset += ${ws};`);
      lines.push(`${indent}            break;`);
    } else {
      // Multi-byte numeric types
      const fieldEndian = f.endian || endian;
      const isBE = fieldEndian === 'big';
      if (ws === 1) {
        lines.push(`${indent}            msg->${nm} = buf[offset];`);
        lines.push(`${indent}            offset += 1;`);
      } else if (ws === 2) {
        if (isBE) {
          lines.push(`${indent}            msg->${nm} = ((uint16_t)buf[offset] << 8) | (uint16_t)buf[offset + 1];`);
        } else {
          lines.push(`${indent}            msg->${nm} = (uint16_t)buf[offset] | ((uint16_t)buf[offset + 1] << 8);`);
        }
        lines.push(`${indent}            offset += 2;`);
      } else if (ws === 4) {
        if (isBE) {
          lines.push(`${indent}            msg->${nm} = ((uint32_t)buf[offset] << 24) | ((uint32_t)buf[offset + 1] << 16) | ((uint32_t)buf[offset + 2] << 8) | (uint32_t)buf[offset + 3];`);
        } else {
          lines.push(`${indent}            msg->${nm} = (uint32_t)buf[offset] | ((uint32_t)buf[offset + 1] << 8) | ((uint32_t)buf[offset + 2] << 16) | ((uint32_t)buf[offset + 3] << 24);`);
        }
        lines.push(`${indent}            offset += 4;`);
      } else if (ws === 8) {
        lines.push(`${indent}            { uint64_t t = 0;`);
        lines.push(`${indent}              for (int j = 0; j < 8; j++) t |= ((uint64_t)buf[offset + j]) << (j * 8);`);
        if (f.type === 'double') {
          lines.push(`${indent}              memcpy(&msg->${nm}, &t, 8); }`);
        } else {
          lines.push(`${indent}              memcpy(&msg->${nm}, &t, 8); }`);
        }
        lines.push(`${indent}            offset += 8;`);
      } else {
        lines.push(`${indent}            /* unhandled wire size ${ws} */`);
        lines.push(`${indent}            offset += field_len;`);
      }
      lines.push(`${indent}            break;`);
    }
  }

  lines.push(`${indent}        default:`);
  lines.push(`${indent}            /* skip unknown tag (forward compat) */`);
  lines.push(`${indent}            offset += field_len;`);
  lines.push(`${indent}            break;`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}}`);
  lines.push(`${indent}return offset;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 15. Optional Field Presence Bitmask ──────────────────────────────────

export function genCOptionalBitmask(fields: ProtocolField[]): string {
  const optFields = fields.filter((f) => f.optional);
  if (optFields.length === 0) return '';
  const maskSize = computeOptionalBitmaskSize(fields);
  const indent = '    ';

  const lines: string[] = [];
  lines.push(`static inline uint${maskSize * 8}_t build_presence_bitmask(const void *_msg) {`);
  lines.push(`${indent}(void)_msg;`);
  lines.push(`${indent}/* Presence bitmask built inline in payload encode; this is a placeholder */`);
  lines.push(`${indent}uint${maskSize * 8}_t mask = 0;`);
  lines.push(`${indent}return mask;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 16. Range Check for a Single Field ───────────────────────────────────

export function genCRangeChecks(field: ProtocolField): string {
  if (field.minValue === undefined || field.maxValue === undefined) return '';
  return `    if (msg->${field.name} < ${field.minValue} || msg->${field.name} > ${field.maxValue}) return -7;\n`;
}

// ──── 17. Validation Function ──────────────────────────────────────────────

export function genCValidation(name: string, fields: ProtocolField[]): string {
  const rangeFields = fields.filter((f) => f.minValue !== undefined && f.maxValue !== undefined);
  if (rangeFields.length === 0) {
    return `static inline int validate_${name}(const ${name} *msg) { (void)msg; return 0; }\n\n`;
  }

  const indent = '    ';
  const lines: string[] = [];
  lines.push(`int validate_${name}(const ${name} *msg) {`);
  for (const f of rangeFields) {
    lines.push(`${indent}if (msg->${f.name} < ${f.minValue} || msg->${f.name} > ${f.maxValue}) return -7;`);
  }
  lines.push(`${indent}return 0;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 18. Sequential Payload Encode (non-TLV) ──────────────────────────────

export function genCPayloadEncode(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const indent = '    ';

  const mandatoryFields = modules.optionalFields ? fields.filter((f) => !f.optional) : fields;
  const optFields = modules.optionalFields ? fields.filter((f) => f.optional) : [];
  const bitmaskSize = modules.optionalFields ? computeOptionalBitmaskSize(fields) : 0;
  const mandatorySize = mandatoryFields.reduce((acc, f) => acc + wireSize(f), 0);
  const minSize = mandatorySize + bitmaskSize;

  const lines: string[] = [];
  lines.push(`static inline int encode_${name}_payload(uint8_t *buf, size_t buf_len, const ${name} *msg) {`);
  lines.push(`${indent}if ((int)buf_len < ${minSize}) return -1;`);
  lines.push(`${indent}int offset = 0;`);

  // Presence bitmask for optional fields (L2, non-TLV)
  if (modules.optionalFields && optFields.length > 0) {
    const maskSize = computeOptionalBitmaskSize(fields);
    lines.push(`${indent}/* presence bitmask for optional fields */`);
    lines.push(`${indent}uint${maskSize * 8}_t presence = 0;`);
    for (let i = 0; i < optFields.length; i++) {
      lines.push(`${indent}if (msg->${optFields[i].name} != 0) presence |= (1u << ${i});`);
    }
    lines.push(`${indent}buf[offset++] = (uint8_t)(presence & 0xFF);`);
    if (maskSize > 1) {
      lines.push(`${indent}buf[offset++] = (uint8_t)((presence >> 8) & 0xFF);`);
    }
  }

  // Encode mandatory fields
  for (const f of mandatoryFields) {
    const enc = genCEncodeField(f, indent, modules, endian);
    lines.push(enc.trimEnd());
  }

  // Encode optional fields (if present)
  if (modules.optionalFields && optFields.length > 0) {
    for (let i = 0; i < optFields.length; i++) {
      lines.push(`${indent}if (presence & (1u << ${i})) {`);
      const enc = genCEncodeField(optFields[i], indent + '    ', modules, endian);
      lines.push(enc.trimEnd());
      lines.push(`${indent}}`);
    }
  }

  lines.push(`${indent}return offset;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 19. Sequential Payload Decode (non-TLV) ──────────────────────────────

export function genCPayloadDecode(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const indent = '    ';

  const mandatoryFields = modules.optionalFields ? fields.filter((f) => !f.optional) : fields;
  const optFields = modules.optionalFields ? fields.filter((f) => f.optional) : [];
  const bitmaskSize = modules.optionalFields ? computeOptionalBitmaskSize(fields) : 0;
  const mandatorySize = mandatoryFields.reduce((acc, f) => acc + wireSize(f), 0);
  const minSize = mandatorySize + bitmaskSize;

  const lines: string[] = [];
  lines.push(`static inline int decode_${name}_payload(const uint8_t *buf, size_t buf_len, ${name} *msg) {`);
  lines.push(`${indent}if ((int)buf_len < ${minSize}) return -5;`);
  lines.push(`${indent}int offset = 0;`);
  lines.push(`${indent}memset(msg, 0, sizeof(*msg));`);

  // Read presence bitmask for optional fields (L2, non-TLV)
  if (modules.optionalFields && optFields.length > 0) {
    const maskSize = computeOptionalBitmaskSize(fields);
    lines.push(`${indent}/* presence bitmask for optional fields */`);
    lines.push(`${indent}uint${maskSize * 8}_t presence = buf[offset++];`);
    if (maskSize > 1) {
      lines.push(`${indent}presence |= (uint16_t)buf[offset++] << 8;`);
    }
  }

  // Decode mandatory fields
  for (const f of mandatoryFields) {
    const dec = genCDecodeField(f, indent, modules, endian);
    lines.push(dec.trimEnd());
  }

  // Decode optional fields (if present)
  if (modules.optionalFields && optFields.length > 0) {
    for (let i = 0; i < optFields.length; i++) {
      lines.push(`${indent}if (presence & (1u << ${i})) {`);
      const dec = genCDecodeField(optFields[i], indent + '    ', modules, endian);
      lines.push(dec.trimEnd());
      lines.push(`${indent}}`);
    }
  }

  lines.push(`${indent}return offset;`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 20. Full Packet Encode (header + payload + optional CRC) ─────────────

export function genCPacketEncode(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
  endian: Endianness,
): string {
  const indent = '    ';
  const hdrSize = getHeaderSize(modules);
  const isBE = endian === 'big';

  if (modules.tlv) {
    // TLV mode: header (payload_len=0) → TLV payload → update header → optional CRC
    const maxFieldSize = fields.reduce((acc, f) => acc + wireSize(f) + 3, 0);
    const crcExtra = modules.crc ? ' + PROTOCOL_CRC_SIZE' : '';

    const lines: string[] = [];
    lines.push(`int encode_${name}(uint8_t *buf, size_t buf_len, const ${name} *msg) {`);
    lines.push(`${indent}if ((int)buf_len < ${hdrSize} + ${maxFieldSize}${crcExtra}) return -1;`);
    lines.push(`${indent}int offset = 0;`);
    lines.push(`${indent}int hdr_ret = encode_header(buf + offset, buf_len - offset, MSG_TYPE_${name}, 0);`);
    lines.push(`${indent}if (hdr_ret < 0) return hdr_ret;`);
    lines.push(`${indent}offset += hdr_ret;`);
    lines.push(`${indent}int pay_ret = encode_${name}_payload(buf + offset, buf_len - offset, msg);`);
    lines.push(`${indent}if (pay_ret < 0) return pay_ret;`);
    lines.push(`${indent}offset += pay_ret;`);
    lines.push(`${indent}/* update header with actual payload length */`);
    lines.push(`${indent}uint16_t actual_pay = (uint16_t)(offset - ${hdrSize});`);
    // payload_len is always at bytes 4-5 (after magic(2) + [version(1)] + msg_type(1))
    const payLenOff = hdrSize - 2;
    if (isBE) {
      lines.push(`${indent}buf[${payLenOff}]     = (uint8_t)((actual_pay >> 8) & 0xFF);`);
      lines.push(`${indent}buf[${payLenOff + 1}] = (uint8_t)(actual_pay & 0xFF);`);
    } else {
      lines.push(`${indent}buf[${payLenOff}]     = (uint8_t)(actual_pay & 0xFF);`);
      lines.push(`${indent}buf[${payLenOff + 1}] = (uint8_t)((actual_pay >> 8) & 0xFF);`);
    }
    if (modules.crc) {
      lines.push(`${indent}{`);
      lines.push(`${indent}  uint16_t crc = crc16(buf, offset);`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)(crc & 0xFF);`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((crc >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += PROTOCOL_CRC_SIZE;`);
      lines.push(`${indent}}`);
    }
    lines.push(`${indent}return offset;`);
    lines.push('}');
    lines.push('');
    return lines.join('\n');
  }

  // Non-TLV mode
  const payloadSize = fields.reduce((acc, f) => acc + wireSize(f), 0);
  const optBitmaskSize = modules.optionalFields ? computeOptionalBitmaskSize(fields) : 0;
  const totalPaySize = payloadSize + optBitmaskSize;

  const lines: string[] = [];
  lines.push(`int encode_${name}(uint8_t *buf, size_t buf_len, const ${name} *msg) {`);
  if (modules.header) {
    const crcExtra = modules.crc ? ' + PROTOCOL_CRC_SIZE' : '';
    lines.push(`${indent}if ((int)buf_len < ${hdrSize} + ${totalPaySize}${crcExtra}) return -1;`);
    lines.push(`${indent}int offset = 0;`);
    lines.push(`${indent}int hdr_ret = encode_header(buf + offset, buf_len - offset, MSG_TYPE_${name}, ${totalPaySize});`);
    lines.push(`${indent}if (hdr_ret < 0) return hdr_ret;`);
    lines.push(`${indent}offset += hdr_ret;`);
    lines.push(`${indent}int pay_ret = encode_${name}_payload(buf + offset, buf_len - offset, msg);`);
    lines.push(`${indent}if (pay_ret < 0) return pay_ret;`);
    lines.push(`${indent}offset += pay_ret;`);
    if (modules.crc) {
      lines.push(`${indent}{`);
      lines.push(`${indent}  uint16_t crc = crc16(buf, offset);`);
      lines.push(`${indent}  buf[offset]     = (uint8_t)(crc & 0xFF);`);
      lines.push(`${indent}  buf[offset + 1] = (uint8_t)((crc >> 8) & 0xFF);`);
      lines.push(`${indent}  offset += PROTOCOL_CRC_SIZE;`);
      lines.push(`${indent}}`);
    }
    lines.push(`${indent}return offset;`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 21. Full Packet Decode (header + payload + optional CRC) ─────────────

export function genCPacketDecode(
  name: string,
  _fields: ProtocolField[],
  modules: ProtocolModules,
  _endian: Endianness,
): string {
  const hdrSize = getHeaderSize(modules);
  const lines: string[] = [];

  lines.push(`int decode_${name}(const uint8_t *buf, size_t buf_len, ${name} *msg) {`);
  lines.push(`    /* Decode and verify protocol header */`);
  lines.push(`    ProtocolHeader hdr;`);
  lines.push(`    int ret = decode_header(buf, buf_len, &hdr);`);
  lines.push(`    if (ret < 0) return ret;`);
  lines.push(`    if (hdr.msg_type != MSG_TYPE_${name}) return -4;`);
  lines.push(``);
  lines.push(`    /* Locate payload within the buffer */`);
  lines.push(`    const uint8_t *pay_buf = buf + ${hdrSize};`);
  lines.push(`    uint16_t pay_len = hdr.payload_len;`);
  lines.push(``);
  if (modules.crc) {
    lines.push(`    /* Verify CRC16 over header + payload */`);
    lines.push(`    if (buf_len < ${hdrSize} + pay_len + PROTOCOL_CRC_SIZE) return -5;`);
    lines.push(`    uint16_t crc_stored = (uint16_t)buf[buf_len - 2] | ((uint16_t)buf[buf_len - 1] << 8);`);
    lines.push(`    uint16_t crc_calc = crc16(buf, buf_len - PROTOCOL_CRC_SIZE);`);
    lines.push(`    if (crc_stored != crc_calc) return -6;`);
  } else {
    lines.push(`    if (buf_len < ${hdrSize} + pay_len) return -5;`);
  }
  lines.push(``);
  lines.push(`    /* Decode payload into struct */`);
  lines.push(`    return decode_${name}_payload(pay_buf, pay_len, msg);`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ──── 22. Size Function ────────────────────────────────────────────────────

export function genCSize(
  name: string,
  fields: ProtocolField[],
  modules: ProtocolModules,
): string {
  const hdrSize = modules.header ? getHeaderSize(modules) : 0;
  const crcSize = modules.crc ? 2 : 0;

  if (modules.tlv) {
    // TLV: maximum size estimate (all fields present, each with 3-byte TLV prefix)
    const maxPaySize = fields.reduce((acc, f) => acc + wireSize(f) + 3, 0);
    return `static inline int ${name}_size(void) { return ${hdrSize + maxPaySize + crcSize}; }\n\n`;
  }

  // Fixed-size mode
  const paySize = fields.reduce((acc, f) => acc + wireSize(f), 0);
  const optBitmaskSize = modules.optionalFields ? computeOptionalBitmaskSize(fields) : 0;
  return `static inline int ${name}_size(void) { return ${hdrSize + paySize + optBitmaskSize + crcSize}; }\n\n`;
}

// ──── 23. Generic decode_packet Dispatcher ─────────────────────────────────

export function genCDecodePacket(ir: ProtocolIR, modules: ProtocolModules): string {
  const allTypes = [
    ...ir.messages.map((m) => ({ name: m.name, kind: 'msg' as const })),
    ...ir.structs.map((s) => ({ name: s.name, kind: 'struct' as const })),
  ];

  if (allTypes.length === 0 || !modules.header) return '';
  const hdrSize = getHeaderSize(modules);

  const indent = '    ';
  const lines: string[] = [];

  lines.push('int decode_packet(const uint8_t *buf, size_t buf_len, ProtocolHeader *hdr, const uint8_t **payload_buf, uint16_t *payload_len) {');
  lines.push(`${indent}int ret = decode_header(buf, buf_len, hdr);`);
  lines.push(`${indent}if (ret < 0) return ret;`);
  lines.push(`${indent}if (hdr->msg_type >= MSG_TYPE_COUNT) return -4;`);

  if (modules.crc) {
    lines.push(`${indent}if (buf_len < ${hdrSize} + hdr->payload_len + PROTOCOL_CRC_SIZE) return -5;`);
    lines.push(`${indent}uint16_t crc_stored = (uint16_t)buf[buf_len - 2] | ((uint16_t)buf[buf_len - 1] << 8);`);
    lines.push(`${indent}uint16_t crc_calc = crc16(buf, buf_len - PROTOCOL_CRC_SIZE);`);
    lines.push(`${indent}if (crc_stored != crc_calc) return -6;`);
  } else {
    lines.push(`${indent}if (buf_len < ${hdrSize} + hdr->payload_len) return -5;`);
  }

  lines.push(`${indent}*payload_buf = buf + ${hdrSize};`);
  lines.push(`${indent}*payload_len = hdr->payload_len;`);
  lines.push(`${indent}return hdr->msg_type;`);
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════════

export function generateC(ir: ProtocolIR): string {
  const modules = resolveModules(ir);
  const parts: string[] = [];

  // 1. Includes and defines
  parts.push(genCHeader(modules));

  // 2. CRC function
  if (modules.crc) {
    parts.push(genCCrcFunction());
  }

  const allTypes = [
    ...ir.messages.map((m) => ({ name: m.name, kind: 'msg' as const })),
    ...ir.structs.map((s) => ({ name: s.name, kind: 'struct' as const })),
  ];

  // 3. MsgType enum
  if (modules.header && allTypes.length > 0) {
    parts.push(genCMsgTypeEnum(allTypes));
  }

  // 4-6. Protocol header struct + encode + decode
  if (modules.header) {
    parts.push(genCProtocolHeader(modules));
    parts.push(genCHeaderEncode(modules, ir.endian));
    parts.push(genCHeaderDecode(modules, ir.endian));
  }

  // 7. User enums
  for (const en of ir.enums) {
    parts.push(genCUserEnum(en));
  }

  // 8-22. Per-type generated code
  for (const t of allTypes) {
    const source = t.kind === 'msg'
      ? ir.messages.find((m) => m.name === t.name)!
      : ir.structs.find((s) => s.name === t.name)!;
    const fields = source.fields
      .map((fid) => ir.fields.find((f) => f.id === fid))
      .filter(Boolean) as ProtocolField[];

    // 8. Struct/message definition
    parts.push(genCStructDef(t.name, fields, modules, ir.enums));

    // -- Payload encode/decode --
    if (modules.tlv) {
      // 12. TLV tag constants
      parts.push(genCTlvTagConstants(t.name, fields));
      // 13. TLV payload encode
      parts.push(genCTlvPayloadEncode(t.name, fields, modules, ir.endian));
      // 14. TLV payload decode
      parts.push(genCTlvPayloadDecode(t.name, fields, modules, ir.endian));
    } else {
      // 15. Optional bitmask helpers (L2 non-TLV)
      if (modules.optionalFields) {
        parts.push(genCOptionalBitmask(fields));
      }
      // 18. Sequential payload encode
      parts.push(genCPayloadEncode(t.name, fields, modules, ir.endian));
      // 19. Sequential payload decode
      parts.push(genCPayloadDecode(t.name, fields, modules, ir.endian));
    }

    // 17. Validation function (L2+)
    if (modules.validation) {
      parts.push(genCValidation(t.name, fields));
    }

    // 20-21. Packet-level encode/decode (with header, only when header enabled)
    if (modules.header) {
      parts.push(genCPacketEncode(t.name, fields, modules, ir.endian));
      parts.push(genCPacketDecode(t.name, fields, modules, ir.endian));
    }

    // 22. Size function
    parts.push(genCSize(t.name, fields, modules));
  }

  // 23. Generic decode_packet dispatcher
  if (modules.header && ir.messages.length > 0) {
    parts.push(genCDecodePacket(ir, modules));
  }

  return parts.join('\n');
}
