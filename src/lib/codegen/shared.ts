import type { ProtocolIR, ProtocolField, FieldType, ProtocolModules, ProtocolLevel, Endianness } from '@/types/protocol';

// ── Level Defaults ──────────────────────────────────────────────────────

export const LEVEL_DEFAULTS: Record<ProtocolLevel, ProtocolModules> = {
  0: { header: false, structTypes: false, enumTypes: false,
       crc: false, optionalFields: false, rangeChecks: false, validation: false,
       tlv: false, versionField: false, forwardCompat: false,
       bitfields: false, unions: false, endianControl: false },
  1: { header: true, structTypes: true, enumTypes: true,
       crc: false, optionalFields: false, rangeChecks: false, validation: false,
       tlv: false, versionField: false, forwardCompat: false,
       bitfields: false, unions: false, endianControl: false },
  2: { header: true, structTypes: true, enumTypes: true,
       crc: true, optionalFields: true, rangeChecks: true, validation: true,
       tlv: false, versionField: false, forwardCompat: false,
       bitfields: false, unions: false, endianControl: false },
  3: { header: true, structTypes: true, enumTypes: true,
       crc: true, optionalFields: true, rangeChecks: true, validation: true,
       tlv: true, versionField: true, forwardCompat: true,
       bitfields: false, unions: false, endianControl: false },
  4: { header: true, structTypes: true, enumTypes: true,
       crc: true, optionalFields: true, rangeChecks: true, validation: true,
       tlv: true, versionField: true, forwardCompat: true,
       bitfields: true, unions: true, endianControl: true },
};

export function resolveModules(ir: ProtocolIR): ProtocolModules {
  const defaults = LEVEL_DEFAULTS[ir.level];
  const overrides = ir.modules;
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof ProtocolModules)[]) {
    if (overrides[key] !== undefined) {
      (result as Record<string, boolean>)[key] = overrides[key];
    }
  }
  return result;
}

export function getHeaderSize(modules: ProtocolModules): number {
  // header always includes magic(2) + msg_type(1) + payload_len(2) = 5
  // L3+ adds version(1) = 6
  if (!modules.header) return 0;
  let size = 5;
  if (modules.versionField) size += 1;
  return size;
}

export function getHeaderLayout(modules: ProtocolModules): string[] {
  if (!modules.header) return [];
  const fields: string[] = ['magic:u16'];
  if (modules.versionField) fields.push('version:u8');
  fields.push('msg_type:u8');
  fields.push('payload_len:u16');
  return fields;
}

// ── Field Sizing ────────────────────────────────────────────────────────

export function getEnumWireSize(field: ProtocolField, ir: ProtocolIR): number {
  const en = findEnumForField(field, ir);
  if (!en) return 1;
  const maxVal = Math.max(...Object.values(en.values));
  if (maxVal <= 0xFF) return 1;
  if (maxVal <= 0xFFFF) return 2;
  return 4;
}

export function getFieldWireSize(field: ProtocolField, ir: ProtocolIR): number {
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
  if (field.type === 'vstring' || field.type === 'vbytes') return 2 + (field.length || 256);
  return 1;
}

export function totalSize(fields: ProtocolField[], ir: ProtocolIR): number {
  return fields.reduce((acc, f) => acc + getFieldWireSize(f, ir), 0);
}

// ── Enum Resolution ─────────────────────────────────────────────────────

export function findEnumForField(field: ProtocolField, ir: ProtocolIR): { name: string; values: Record<string, number> } | null {
  if (field.type !== 'enum') return null;
  if (ir.enums.length === 0) return null;
  const byName = ir.enums.find((e) =>
    field.name.toLowerCase().includes(e.name.toLowerCase().replace(/[a-z]/g, '')) ||
    field.name.toLowerCase().includes(e.name.toLowerCase())
  );
  if (byName) return byName;
  for (const en of ir.enums) {
    const fieldBase = field.name.replace(/_?code$/, '').replace(/_?type$/, '').replace(/_?status$/, '');
    if (en.name.toLowerCase().includes(fieldBase)) return en;
  }
  return ir.enums[0];
}

// ── Optional Bitmask ────────────────────────────────────────────────────

export function computeOptionalBitmaskSize(fields: ProtocolField[]): number {
  const count = fields.filter((f) => f.optional).length;
  if (count === 0) return 0;
  // 1 byte per 8 optional fields
  return Math.max(1, Math.ceil(count / 8));
}

// ── Endian ──────────────────────────────────────────────────────────────

export function getStructPackPrefix(endian: Endianness): '<' | '>' {
  return endian === 'big' ? '>' : '<';
}

export function getEndianFnSuffix(endian: Endianness): string {
  return endian === 'big' ? 'to_be_bytes' : 'to_le_bytes';
}

export function getEndianFromFnSuffix(endian: Endianness): string {
  return endian === 'big' ? 'from_be_bytes' : 'from_le_bytes';
}

// ── Field type helpers ───────────────────────────────────────────────────

export function isVarField(type: FieldType): boolean {
  return type === 'vstring' || type === 'vbytes';
}

export function isFixedField(type: FieldType): boolean {
  return !isVarField(type) && type !== 'string' && type !== 'bytes' && type !== 'array';
}
