import { create } from 'zustand';
import type {
  ProtocolIR,
  ProtocolField,
  ProtocolMessage,
  ProtocolStruct,
  ProtocolEnum,
  CanvasNode,
  CanvasEdge,
} from '@/types/protocol';

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

  loadProject: (data: { name: string; ir: ProtocolIR }) => void;
  exportProject: () => { name: string; ir: ProtocolIR };
  resetProject: () => void;
}

const defaultIR: ProtocolIR = {
  version: '1.0.0',
  messages: [],
  structs: [],
  enums: [],
  fields: [],
};

export const useProtocolStore = create<ProtocolStore>((set, get) => ({
  ir: { ...defaultIR },
  nodes: [],
  edges: [],
  selectedNodeId: null,
  projectName: 'Untitled Protocol',

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

  getFieldById: (id) => get().ir.fields.find((f) => f.id === id),
  getMessageById: (id) => get().ir.messages.find((m) => m.id === id),
  getStructById: (id) => get().ir.structs.find((s) => s.id === id),
  getEnumById: (id) => get().ir.enums.find((e) => e.id === id),

  loadProject: (data) =>
    set({
      projectName: data.name,
      ir: data.ir,
      nodes: [],
      edges: [],
      selectedNodeId: null,
    }),

  exportProject: () => ({
    name: get().projectName,
    ir: get().ir,
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
