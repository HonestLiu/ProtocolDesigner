import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box } from 'lucide-react';

export const StructNode = memo(({ data, selected }: NodeProps) => {
  const label = (data as { label?: string }).label || 'Struct';

  return (
    <div
      className={`
        rounded-xl border-2 px-4 py-3 min-w-[160px]
        bg-gradient-to-br from-emerald-500/10 to-teal-500/10
        border-emerald-500/30 backdrop-blur-sm
        shadow-lg shadow-emerald-500/10
        transition-all duration-200
        ${selected ? 'border-emerald-400 shadow-emerald-400/30 scale-105' : 'hover:border-emerald-400/50'}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
          <Box className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <span className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">Struct</span>
      </div>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-emerald-500" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-emerald-500" />
    </div>
  );
});

StructNode.displayName = 'StructNode';
