import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';

export const MessageNode = memo(({ data, selected }: NodeProps) => {
  const label = (data as { label?: string }).label || 'Message';

  return (
    <div
      className={`
        rounded-xl border-2 px-4 py-3 min-w-[160px]
        bg-gradient-to-br from-violet-500/10 to-purple-500/10
        border-violet-500/30 backdrop-blur-sm
        shadow-lg shadow-violet-500/10
        transition-all duration-200
        ${selected ? 'border-violet-400 shadow-violet-400/30 scale-105' : 'hover:border-violet-400/50'}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center">
          <FileText className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Message</span>
      </div>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-violet-500" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-violet-500" />
    </div>
  );
});

MessageNode.displayName = 'MessageNode';
