export type FieldType =
  | 'uint8'
  | 'int8'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'uint64'
  | 'int64'
  | 'float'
  | 'double'
  | 'bool'
  | 'char'
  | 'string'
  | 'bytes'
  | 'struct'
  | 'enum'
  | 'array'
  | 'vstring'
  | 'vbytes';

export type NodeType = 'message' | 'field' | 'struct' | 'enum';

export type ProtocolLevel = 0 | 1 | 2 | 3 | 4;
export type Endianness = 'little' | 'big';

export interface ProtocolModules {
  // Level 1: Basic
  header: boolean;
  structTypes: boolean;
  enumTypes: boolean;
  // Level 2: Engineering
  crc: boolean;
  optionalFields: boolean;
  rangeChecks: boolean;
  validation: boolean;
  // Level 3: Industrial
  tlv: boolean;
  versionField: boolean;
  forwardCompat: boolean;
  // Level 4: Full
  bitfields: boolean;
  unions: boolean;
  endianControl: boolean;
}

export interface ProtocolField {
  id: string;
  name: string;
  type: FieldType;
  length?: number;
  defaultValue?: string;
  optional?: boolean;
  comment?: string;
  enumValues?: Record<string, number>;
  structRef?: string;
  fieldTag?: number;
  // Level 2: range checks
  minValue?: number;
  maxValue?: number;
  // Level 4: advanced
  bitOffset?: number;
  bitWidth?: number;
  unionDiscriminant?: number;
  endian?: Endianness;
}

export interface ProtocolMessage {
  id: string;
  name: string;
  fields: string[];
}

export interface ProtocolStruct {
  id: string;
  name: string;
  fields: string[];
}

export interface ProtocolEnum {
  id: string;
  name: string;
  values: Record<string, number>;
}

export interface ProtocolIR {
  version: string;
  level: ProtocolLevel;
  modules: ProtocolModules;
  endian: Endianness;
  messages: ProtocolMessage[];
  structs: ProtocolStruct[];
  enums: ProtocolEnum[];
  fields: ProtocolField[];
  /** @deprecated Use level + modules instead */
  crcEnabled?: boolean;
  /** @deprecated Use level + modules instead */
  tlvEnabled?: boolean;
}

export interface ProtocolProject {
  name: string;
  version: string;
  ir: ProtocolIR;
  createdAt: string;
  updatedAt: string;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
