import { ReactFlowProvider } from '@xyflow/react';
import { ProtocolCanvas } from '@/components/canvas/protocol-canvas';
import { PropertiesPanel } from '@/components/panels/properties-panel';
import { Toolbar } from '@/components/toolbar/toolbar';

export default function App() {
  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen flex flex-col bg-background text-foreground">
        <div className="relative z-50">
          <Toolbar />
        </div>
        <div className="flex flex-1 overflow-hidden relative z-0">
          <ProtocolCanvas />
          <PropertiesPanel />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
