import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Hash } from 'lucide-react';

export const FieldNode = memo(({ data, selected }: NodeProps) => {
  const label = (data as { label?: string }).label || 'Field';
  const type = (data as { fieldType?: string }).fieldType || 'uint8';

  return (
    <div
      className={`
        rounded-lg border px-3 py-2 min-w-[120px]
        bg-gradient-to-br from-sky-500/10 to-cyan-500/10
        border-sky-500/30 backdrop-blur-sm
        shadow-md shadow-sky-500/10
        transition-all duration-200
        ${selected ? 'border-sky-400 shadow-sky-400/30 scale-105' : 'hover:border-sky-400/50'}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
          <Hash className="w-3 h-3 text-sky-400" />
        </div>
        <span className="text-[10px] font-medium text-sky-400 uppercase tracking-wider">{type}</span>
      </div>
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
});

FieldNode.displayName = 'FieldNode';
