import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type NodeRemoveChange,
  BackgroundVariant,
  type OnNodeDrag,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useProtocolStore } from '@/store/protocol-store';
import { MessageNode } from '@/components/nodes/message-node';
import { FieldNode } from '@/components/nodes/field-node';
import { StructNode } from '@/components/nodes/struct-node';
import { EnumNode } from '@/components/nodes/enum-node';
import type { Node, Edge } from '@xyflow/react';

const nodeTypes: NodeTypes = {
  message: MessageNode,
  field: FieldNode,
  struct: StructNode,
  enum: EnumNode,
};

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  style: { strokeWidth: 2, stroke: '#8b5cf6' },
};

export function ProtocolCanvas() {
  const storeNodes = useProtocolStore((s) => s.nodes);
  const storeEdges = useProtocolStore((s) => s.edges);
  const setSelectedNode = useProtocolStore((s) => s.setSelectedNode);
  const updateNodePosition = useProtocolStore((s) => s.updateNodePosition);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setNodes(
      storeNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: { label: n.data.label, fieldType: n.data.fieldType },
      }))
    );
  }, [storeNodes]);

  useEffect(() => {
    setEdges(
      storeEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
      }))
    );
  }, [storeEdges]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Sync node deletions to the store
      for (const change of changes) {
        if (change.type === 'remove') {
          const id = (change as NodeRemoveChange).id;
          const store = useProtocolStore.getState();
          const node = store.nodes.find((n) => n.id === id);
          if (!node) continue;
          if (node.type === 'field') store.removeField(id);
          else if (node.type === 'message') store.removeMessage(id);
          else if (node.type === 'struct') store.removeStruct(id);
          else if (node.type === 'enum') store.removeEnum(id);
        }
      }
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // Sync edge deletions to the store
      for (const change of changes) {
        if (change.type === 'remove') {
          useProtocolStore.getState().removeEdge(change.id);
        }
      }
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const store = useProtocolStore.getState();
      const sourceNode = store.nodes.find((n) => n.id === connection.source);
      const targetNode = store.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      // Determine container (message/struct) and which endpoint is the field
      let containerId: string | null = null;
      let fieldId: string | null = null;
      let containerType: 'message' | 'struct' | null = null;

      if (sourceNode.type === 'message' || sourceNode.type === 'struct') {
        containerType = sourceNode.type;
        containerId = connection.source;
        fieldId = connection.target;
      } else if (targetNode.type === 'message' || targetNode.type === 'struct') {
        containerType = targetNode.type;
        containerId = connection.target;
        fieldId = connection.source;
      }

      // Only create connection if one end is a container and the other is a field
      if (!containerType || !containerId || !fieldId) return;
      const field = store.ir.fields.find((f) => f.id === fieldId);
      if (!field) return;

      // Add field to container's field list
      if (containerType === 'message') {
        const msg = store.ir.messages.find((m) => m.id === containerId);
        if (msg && !msg.fields.includes(fieldId)) {
          useProtocolStore.getState().updateMessage(containerId, {
            fields: [...msg.fields, fieldId],
          });
        }
      } else {
        const st = store.ir.structs.find((s) => s.id === containerId);
        if (st && !st.fields.includes(fieldId)) {
          useProtocolStore.getState().updateStruct(containerId, {
            fields: [...st.fields, fieldId],
          });
        }
      }

      const edgeId = `e-${connection.source}-${connection.target}`;
      useProtocolStore.getState().addEdge({
        id: edgeId,
        source: connection.source,
        target: connection.target,
      });

      setEdges((eds) => addEdge({ ...connection, id: edgeId, animated: true }, eds));
    },
    []
  );

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      updateNodePosition(node.id, node.position);
    },
    [updateNodePosition]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        className="bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--muted-foreground) / 0.15)"
        />
        <Controls className="!bg-card !border-border !shadow-lg !rounded-xl" />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === 'message') return '#8b5cf6';
            if (n.type === 'struct') return '#10b981';
            if (n.type === 'enum') return '#f59e0b';
            return '#0ea5e9';
          }}
          maskColor="hsl(var(--background) / 0.7)"
          className="!bg-card !border-border !shadow-lg !rounded-xl"
        />
      </ReactFlow>
    </div>
  );
}
