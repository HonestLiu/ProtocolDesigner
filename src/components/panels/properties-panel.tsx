import { useProtocolStore } from '@/store/protocol-store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FieldType } from '@/types/protocol';

const FIELD_TYPES: FieldType[] = [
  'uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32',
  'uint64', 'int64', 'float', 'double', 'bool', 'char',
  'string', 'bytes', 'struct', 'enum', 'array',
  'vstring', 'vbytes',
];

export function PropertiesPanel() {
  const selectedNodeId = useProtocolStore((s) => s.selectedNodeId);
  const fields = useProtocolStore((s) => s.ir.fields);
  const messages = useProtocolStore((s) => s.ir.messages);
  const structs = useProtocolStore((s) => s.ir.structs);
  const enums = useProtocolStore((s) => s.ir.enums);
  const tlvEnabled = useProtocolStore((s) => s.ir.tlvEnabled ?? false);
  const updateField = useProtocolStore((s) => s.updateField);
  const updateMessage = useProtocolStore((s) => s.updateMessage);
  const updateStruct = useProtocolStore((s) => s.updateStruct);
  const updateEnum = useProtocolStore((s) => s.updateEnum);
  const removeMessage = useProtocolStore((s) => s.removeMessage);
  const removeStruct = useProtocolStore((s) => s.removeStruct);
  const removeEnum = useProtocolStore((s) => s.removeEnum);
  const setSelectedNode = useProtocolStore((s) => s.setSelectedNode);

  const selectedField = fields.find((f) => f.id === selectedNodeId);
  const selectedMessage = messages.find((m) => m.id === selectedNodeId);
  const selectedStruct = structs.find((s) => s.id === selectedNodeId);
  const selectedEnum = enums.find((e) => e.id === selectedNodeId);

  const selected = selectedField || selectedMessage || selectedStruct || selectedEnum;
  const nodeType = selectedField ? 'field' : selectedMessage ? 'message' : selectedStruct ? 'struct' : selectedEnum ? 'enum' : null;

  const handleDelete = () => {
    if (!selectedNodeId) return;
    if (selectedField) {
      useProtocolStore.getState().removeField(selectedNodeId);
    } else if (selectedMessage) {
      removeMessage(selectedNodeId);
    } else if (selectedStruct) {
      removeStruct(selectedNodeId);
    } else if (selectedEnum) {
      removeEnum(selectedNodeId);
    }
    setSelectedNode(null);
  };

  if (!selected) {
    return (
      <div className="w-80 border-l border-border bg-card/50 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
          <span className="text-xl">🎯</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Select a node on the canvas to edit its properties
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border bg-card/50 backdrop-blur-sm flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{nodeType}</p>
          <p className="text-sm font-semibold">{selectedField?.name || selectedMessage?.name || selectedStruct?.name || selectedEnum?.name}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedNode(null)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Name</Label>
            <Input
              value={selectedField?.name || selectedMessage?.name || selectedStruct?.name || selectedEnum?.name || ''}
              onChange={(e) => {
                if (selectedField) updateField(selectedNodeId!, { name: e.target.value });
                else if (selectedMessage) updateMessage(selectedNodeId!, { name: e.target.value });
                else if (selectedStruct) updateStruct(selectedNodeId!, { name: e.target.value });
                else if (selectedEnum) updateEnum(selectedNodeId!, { name: e.target.value });
              }}
              className="h-8 text-sm"
            />
          </div>

          {selectedField && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs">Type</Label>
                <Select
                  value={selectedField.type}
                  onValueChange={(v: string | null) => { if (v) updateField(selectedNodeId!, { type: v as FieldType }); }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tlvEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs">TLV Tag</Label>
                  <Input
                    type="number"
                    value={selectedField.fieldTag ?? ''}
                    onChange={(e) => updateField(selectedNodeId!, { fieldTag: parseInt(e.target.value) || undefined })}
                    placeholder="Auto"
                    className="h-8 text-sm"
                    min={0}
                    max={255}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Length</Label>
                <Input
                  type="number"
                  value={selectedField.length || ''}
                  onChange={(e) => updateField(selectedNodeId!, { length: parseInt(e.target.value) || undefined })}
                  placeholder="Auto"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Default Value</Label>
                <Input
                  value={selectedField.defaultValue || ''}
                  onChange={(e) => updateField(selectedNodeId!, { defaultValue: e.target.value })}
                  placeholder="None"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Comment</Label>
                <Textarea
                  value={selectedField.comment || ''}
                  onChange={(e) => updateField(selectedNodeId!, { comment: e.target.value })}
                  placeholder="Add description..."
                  className="text-sm resize-none min-h-[60px]"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedField.optional || false}
                  onChange={(e) => updateField(selectedNodeId!, { optional: e.target.checked })}
                  className="rounded border-border"
                />
                <Label className="text-xs">Optional</Label>
              </div>
            </>
          )}

          {selectedEnum && (
            <>
              <Separator />
              <Label className="text-xs">Enum Values</Label>
              {Object.entries(selectedEnum.values).map(([key, val]) => (
                <div key={key} className="flex gap-2 items-center">
                  <Input value={key} className="h-8 text-sm flex-1" readOnly />
                  <Input type="number" value={val} className="h-8 text-sm w-20" readOnly />
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
