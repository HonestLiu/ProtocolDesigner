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
  | 'array';

export type NodeType = 'message' | 'field' | 'struct' | 'enum';

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
  messages: ProtocolMessage[];
  structs: ProtocolStruct[];
  enums: ProtocolEnum[];
  fields: ProtocolField[];
  crcEnabled?: boolean;
}

export interface ProtocolProject {
  name: string;
  version: string;
  ir: ProtocolIR;
  createdAt: string;
  updatedAt: string;
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
