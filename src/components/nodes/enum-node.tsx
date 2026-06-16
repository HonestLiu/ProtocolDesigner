import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { List } from 'lucide-react';

export const EnumNode = memo(({ data, selected }: NodeProps) => {
  const label = (data as { label?: string }).label || 'Enum';

  return (
    <div
      className={`
        rounded-xl border-2 px-4 py-3 min-w-[160px]
        bg-gradient-to-br from-amber-500/10 to-orange-500/10
        border-amber-500/30 backdrop-blur-sm
        shadow-lg shadow-amber-500/10
        transition-all duration-200
        ${selected ? 'border-amber-400 shadow-amber-400/30 scale-105' : 'hover:border-amber-400/50'}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center">
          <List className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">Enum</span>
      </div>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-500" />
    </div>
  );
});

EnumNode.displayName = 'EnumNode';
