import { create } from 'zustand';
import type {
  ProtocolIR, ProtocolLevel, ProtocolModules, Endianness,
  ProtocolField, ProtocolMessage, ProtocolStruct, ProtocolEnum,
  CanvasNode, CanvasEdge,
} from '@/types/protocol';
import { LEVEL_DEFAULTS } from '@/lib/codegen/shared';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ProtocolStore {
  ir: ProtocolIR;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  projectName: string;

  setSelectedNode: (id: string | null) => void;
  addField: (field: Omit<ProtocolField, 'id'>) => string;
  updateField: (id: string, updates: Partial<ProtocolField>) => void;
  removeField: (id: string) => void;

  addMessage: (name: string) => string;
  updateMessage: (id: string, updates: Partial<ProtocolMessage>) => void;
  removeMessage: (id: string) => void;

  addStruct: (name: string) => string;
  updateStruct: (id: string, updates: Partial<ProtocolStruct>) => void;
  removeStruct: (id: string) => void;

  addEnum: (name: string, values: Record<string, number>) => string;
  updateEnum: (id: string, updates: Partial<ProtocolEnum>) => void;
  removeEnum: (id: string) => void;

  addNode: (node: CanvasNode) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;

  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (id: string) => void;

  getFieldById: (id: string) => ProtocolField | undefined;
  getMessageById: (id: string) => ProtocolMessage | undefined;
  getStructById: (id: string) => ProtocolStruct | undefined;
  getEnumById: (id: string) => ProtocolEnum | undefined;

  setLevel: (level: ProtocolLevel) => void;
  setModules: (overrides: Partial<ProtocolModules>) => void;
  setEndian: (endian: Endianness) => void;
  loadProject: (data: { name: string; ir: ProtocolIR; nodes?: CanvasNode[]; edges?: CanvasEdge[] }) => void;
  exportProject: () => { name: string; ir: ProtocolIR; nodes: CanvasNode[]; edges: CanvasEdge[] };
  resetProject: () => void;
}

const demoFields: ProtocolField[] = [
  { id: 'f-sensor-id', name: 'sensor_id', type: 'uint8', comment: 'Sensor identifier (0-255)' },
  { id: 'f-sensor-temp', name: 'temperature', type: 'float', comment: 'Temperature in Celsius' },
  { id: 'f-sensor-humid', name: 'humidity', type: 'uint16', comment: 'Relative humidity %' },
  { id: 'f-sensor-status', name: 'status', type: 'enum', comment: 'Sensor status code' },
  { id: 'f-motor-rpm', name: 'rpm', type: 'uint16', comment: 'Motor speed in RPM' },
  { id: 'f-motor-dir', name: 'direction', type: 'uint8', comment: '0=CW, 1=CCW' },
  { id: 'f-motor-err', name: 'error_code', type: 'enum', comment: 'Motor error code' },
  { id: 'f-config-interval', name: 'interval_ms', type: 'uint32', optional: true, comment: 'Sample interval in ms' },
  { id: 'f-config-mode', name: 'mode', type: 'uint8', comment: 'Operating mode' },
  { id: 'f-config-buffer', name: 'buffer', type: 'bytes', length: 32, comment: 'Config buffer' },
];

const demoMessages: ProtocolMessage[] = [
  { id: 'msg-sensor', name: 'SensorData', fields: ['f-sensor-id', 'f-sensor-temp', 'f-sensor-humid', 'f-sensor-status'] },
  { id: 'msg-motor', name: 'MotorCommand', fields: ['f-motor-rpm', 'f-motor-dir', 'f-motor-err'] },
];

const demoStructs: ProtocolStruct[] = [
  { id: 'st-config', name: 'SensorConfig', fields: ['f-config-interval', 'f-config-mode', 'f-config-buffer'] },
];

const demoEnums: ProtocolEnum[] = [
  { id: 'en-status', name: 'SensorStatus', values: { OK: 0, WARNING: 1, ERROR: 2, OFFLINE: 3 } },
  { id: 'en-error', name: 'MotorError', values: { NONE: 0, OVERHEAT: 1, STALL: 2, OVERCURRENT: 3 } },
];

const defaultIR: ProtocolIR = {
  version: '1.0.0',
  level: 1,
  modules: LEVEL_DEFAULTS[1],
  endian: 'little',
  messages: demoMessages,
  structs: demoStructs,
  enums: demoEnums,
  fields: demoFields,
};

const demoNodes: CanvasNode[] = [
  { id: 'msg-sensor', type: 'message', position: { x: 80, y: 60 }, data: { label: 'SensorData' } },
  { id: 'f-sensor-id', type: 'field', position: { x: 380, y: 20 }, data: { label: 'sensor_id', fieldType: 'uint8' } },
  { id: 'f-sensor-temp', type: 'field', position: { x: 380, y: 100 }, data: { label: 'temperature', fieldType: 'float' } },
  { id: 'f-sensor-humid', type: 'field', position: { x: 380, y: 180 }, data: { label: 'humidity', fieldType: 'uint16' } },
  { id: 'f-sensor-status', type: 'field', position: { x: 380, y: 260 }, data: { label: 'status', fieldType: 'enum' } },

  { id: 'msg-motor', type: 'message', position: { x: 80, y: 380 }, data: { label: 'MotorCommand' } },
  { id: 'f-motor-rpm', type: 'field', position: { x: 380, y: 340 }, data: { label: 'rpm', fieldType: 'uint16' } },
  { id: 'f-motor-dir', type: 'field', position: { x: 380, y: 420 }, data: { label: 'direction', fieldType: 'uint8' } },
  { id: 'f-motor-err', type: 'field', position: { x: 380, y: 500 }, data: { label: 'error_code', fieldType: 'enum' } },

  { id: 'st-config', type: 'struct', position: { x: 700, y: 60 }, data: { label: 'SensorConfig' } },
  { id: 'f-config-interval', type: 'field', position: { x: 1000, y: 20 }, data: { label: 'interval_ms', fieldType: 'uint32' } },
  { id: 'f-config-mode', type: 'field', position: { x: 1000, y: 100 }, data: { label: 'mode', fieldType: 'uint8' } },
  { id: 'f-config-buffer', type: 'field', position: { x: 1000, y: 180 }, data: { label: 'buffer', fieldType: 'bytes' } },

  { id: 'en-status', type: 'enum', position: { x: 700, y: 340 }, data: { label: 'SensorStatus' } },
  { id: 'en-error', type: 'enum', position: { x: 700, y: 500 }, data: { label: 'MotorError' } },
];

const demoEdges: CanvasEdge[] = [
  { id: 'e-sensor-id', source: 'msg-sensor', target: 'f-sensor-id' },
  { id: 'e-sensor-temp', source: 'msg-sensor', target: 'f-sensor-temp' },
  { id: 'e-sensor-humid', source: 'msg-sensor', target: 'f-sensor-humid' },
  { id: 'e-sensor-status', source: 'msg-sensor', target: 'f-sensor-status' },
  { id: 'e-motor-rpm', source: 'msg-motor', target: 'f-motor-rpm' },
  { id: 'e-motor-dir', source: 'msg-motor', target: 'f-motor-dir' },
  { id: 'e-motor-err', source: 'msg-motor', target: 'f-motor-err' },
  { id: 'e-config-interval', source: 'st-config', target: 'f-config-interval' },
  { id: 'e-config-mode', source: 'st-config', target: 'f-config-mode' },
  { id: 'e-config-buffer', source: 'st-config', target: 'f-config-buffer' },
];

export const useProtocolStore = create<ProtocolStore>((set, get) => ({
  ir: { ...defaultIR },
  nodes: demoNodes,
  edges: demoEdges,
  selectedNodeId: null,
  projectName: 'Demo Protocol',

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addField: (field) => {
    const id = generateId();
    const newField: ProtocolField = { ...field, id };
    const node: CanvasNode = {
      id,
      type: 'field',
      position: { x: 100 + Math.random() * 300, y: 100 + Math.random() * 300 },
      data: { label: field.name, fieldType: field.type },
    };
    set((s) => ({
      ir: { ...s.ir, fields: [...s.ir.fields, newField] },
      nodes: [...s.nodes, node],
    }));
    return id;
  },

  updateField: (id, updates) =>
    set((s) => ({
      ir: {
        ...s.ir,
        fields: s.ir.fields.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      },
    })),

  removeField: (id) =>
    set((s) => ({
      ir: {
        ...s.ir,
        fields: s.ir.fields.filter((f) => f.id !== id),
        messages: s.ir.messages.map((m) => ({
          ...m,
          fields: m.fields.filter((f) => f !== id),
        })),
        structs: s.ir.structs.map((st) => ({
          ...st,
          fields: st.fields.filter((f) => f !== id),
        })),
      },
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  addMessage: (name) => {
    const id = generateId();
    const newMessage: ProtocolMessage = { id, name, fields: [] };
    const node: CanvasNode = {
      id,
      type: 'message',
      position: { x: 250, y: 250 },
      data: { label: name },
    };
    set((s) => ({
      ir: { ...s.ir, messages: [...s.ir.messages, newMessage] },
      nodes: [...s.nodes, node],
    }));
    return id;
  },

  updateMessage: (id, updates) =>
    set((s) => ({
      ir: {
        ...s.ir,
        messages: s.ir.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      },
      nodes: s.nodes.map((n) =>
        n.id === id && updates.name ? { ...n, data: { ...n.data, label: updates.name } } : n
      ),
    })),

  removeMessage: (id) =>
    set((s) => ({
      ir: {
        ...s.ir,
        messages: s.ir.messages.filter((m) => m.id !== id),
      },
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  addStruct: (name) => {
    const id = generateId();
    const newStruct: ProtocolStruct = { id, name, fields: [] };
    const node: CanvasNode = {
      id,
      type: 'struct',
      position: { x: 250, y: 250 },
      data: { label: name },
    };
    set((s) => ({
      ir: { ...s.ir, structs: [...s.ir.structs, newStruct] },
      nodes: [...s.nodes, node],
    }));
    return id;
  },

  updateStruct: (id, updates) =>
    set((s) => ({
      ir: {
        ...s.ir,
        structs: s.ir.structs.map((st) => (st.id === id ? { ...st, ...updates } : st)),
      },
      nodes: s.nodes.map((n) =>
        n.id === id && updates.name ? { ...n, data: { ...n.data, label: updates.name } } : n
      ),
    })),

  removeStruct: (id) =>
    set((s) => ({
      ir: {
        ...s.ir,
        structs: s.ir.structs.filter((st) => st.id !== id),
      },
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  addEnum: (name, values) => {
    const id = generateId();
    const newEnum: ProtocolEnum = { id, name, values };
    const node: CanvasNode = {
      id,
      type: 'enum',
      position: { x: 250, y: 250 },
      data: { label: name },
    };
    set((s) => ({
      ir: { ...s.ir, enums: [...s.ir.enums, newEnum] },
      nodes: [...s.nodes, node],
    }));
    return id;
  },

  updateEnum: (id, updates) =>
    set((s) => ({
      ir: {
        ...s.ir,
        enums: s.ir.enums.map((e) => (e.id === id ? { ...e, ...updates } : e)),
      },
      nodes: s.nodes.map((n) =>
        n.id === id && updates.name ? { ...n, data: { ...n.data, label: updates.name } } : n
      ),
    })),

  removeEnum: (id) =>
    set((s) => ({
      ir: {
        ...s.ir,
        enums: s.ir.enums.filter((e) => e.id !== id),
      },
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),

  updateNodePosition: (id, position) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    })),

  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    })),

  addEdge: (edge) => set((s) => ({ edges: [...s.edges, edge] })),

  removeEdge: (id) => set((s) => ({ edges: s.edges.filter((e) => e.id !== id) })),

  setLevel: (level) =>
    set((s) => ({
      ir: {
        ...s.ir,
        level,
        modules: { ...LEVEL_DEFAULTS[level] },
      },
    })),

  setModules: (overrides) =>
    set((s) => ({
      ir: {
        ...s.ir,
        modules: { ...s.ir.modules, ...overrides },
      },
    })),

  setEndian: (endian) =>
    set((s) => ({
      ir: { ...s.ir, endian },
    })),

  getFieldById: (id) => get().ir.fields.find((f) => f.id === id),
  getMessageById: (id) => get().ir.messages.find((m) => m.id === id),
  getStructById: (id) => get().ir.structs.find((s) => s.id === id),
  getEnumById: (id) => get().ir.enums.find((e) => e.id === id),

  loadProject: (data) => {
    // Ensure required fields exist (migration from old format or truncated by Rust IPC)
    const ir = data.ir as ProtocolIR & { crcEnabled?: boolean; tlvEnabled?: boolean };
    if (ir.level === undefined) {
      if (ir.crcEnabled !== undefined || ir.tlvEnabled !== undefined) {
        // Old format with crcEnabled/tlvEnabled
        const oldCrc = ir.crcEnabled ?? false;
        const oldTlv = ir.tlvEnabled ?? false;
        let level: ProtocolLevel = 1;
        if (oldCrc && oldTlv) level = 3;
        else if (oldTlv) level = 3;
        else if (oldCrc) level = 2;
        ir.level = level;
        ir.modules = { ...LEVEL_DEFAULTS[level] };
        ir.endian = 'little';
        delete ir.crcEnabled;
        delete ir.tlvEnabled;
      } else {
        // Missing entirely (e.g., saved from older build) → default to Level 1
        ir.level = 1;
        ir.modules = { ...LEVEL_DEFAULTS[1] };
        ir.endian = 'little';
      }
    }

    const savedNodes = data.nodes && data.nodes.length > 0 ? data.nodes : null;
    const savedEdges = data.edges && data.edges.length > 0 ? data.edges : null;

    if (savedNodes && savedEdges) {
      return set({
        projectName: data.name,
        ir: ir as ProtocolIR,
        nodes: savedNodes,
        edges: savedEdges,
        selectedNodeId: null,
      });
    }

    // Recreate canvas nodes and edges from the loaded IR
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    const Y_STEP = 80;
    const X_OFF = 300;

    // Messages: each message + its fields in a row
    let yPos = 60;
    for (const msg of ir.messages) {
      nodes.push({
        id: msg.id,
        type: 'message',
        position: { x: 80, y: yPos },
        data: { label: msg.name },
      });
      let fy = yPos;
      for (const fid of msg.fields) {
        const field = ir.fields.find((f) => f.id === fid);
        if (field) {
          if (!nodes.find((n) => n.id === field.id)) {
            nodes.push({
              id: field.id,
              type: 'field',
              position: { x: 80 + X_OFF, y: fy },
              data: { label: field.name, fieldType: field.type },
            });
          }
          edges.push({
            id: `${msg.id}-${field.id}`,
            source: msg.id,
            target: field.id,
          });
        }
        fy += Y_STEP;
      }
      yPos = fy + 40;
    }

    // Structs: each struct + its fields in a separate column
    let syPos = 60;
    const structX = Math.max(80 + X_OFF + X_OFF, 700);
    for (const st of ir.structs) {
      nodes.push({
        id: st.id,
        type: 'struct',
        position: { x: structX, y: syPos },
        data: { label: st.name },
      });
      let fy = syPos;
      for (const fid of st.fields) {
        const field = ir.fields.find((f) => f.id === fid);
        if (field) {
          if (!nodes.find((n) => n.id === field.id)) {
            nodes.push({
              id: field.id,
              type: 'field',
              position: { x: structX + X_OFF, y: fy },
              data: { label: field.name, fieldType: field.type },
            });
          }
          edges.push({
            id: `${st.id}-${field.id}`,
            source: st.id,
            target: field.id,
          });
        }
        fy += Y_STEP;
      }
      syPos = fy + 40;
    }

    // Enums: below structs
    let eyPos = Math.max(yPos, syPos);
    for (const en of ir.enums) {
      if (!nodes.find((n) => n.id === en.id)) {
        nodes.push({
          id: en.id,
          type: 'enum',
          position: { x: structX, y: eyPos },
          data: { label: en.name },
        });
        eyPos += Y_STEP;
      }
    }

    return set({
      projectName: data.name,
      ir: ir as ProtocolIR,
      nodes,
      edges,
      selectedNodeId: null,
    });
  },

  exportProject: () => ({
    name: get().projectName,
    ir: get().ir,
    nodes: get().nodes,
    edges: get().edges,
  }),

  resetProject: () =>
    set({
      ir: { ...defaultIR },
      nodes: [],
      edges: [],
      selectedNodeId: null,
      projectName: 'Untitled Protocol',
    }),
}));
