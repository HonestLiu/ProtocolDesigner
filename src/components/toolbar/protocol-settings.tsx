import { useState } from 'react';
import { useProtocolStore } from '@/store/protocol-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { ProtocolLevel, ProtocolModules, Endianness } from '@/types/protocol';
import { LEVEL_DEFAULTS, resolveModules } from '@/lib/codegen/shared';

const LEVEL_NAMES: Record<ProtocolLevel, string> = {
  0: 'Level 0 — Minimal',
  1: 'Level 1 — Basic',
  2: 'Level 2 — Engineering',
  3: 'Level 3 — Industrial',
  4: 'Level 4 — Full',
};

const LEVEL_DESCRIPTIONS: Record<ProtocolLevel, string> = {
  0: 'Raw packed fields, no header, no framing. Direct sequential encode/decode.',
  1: 'Basic protocol with header (magic + msg_type), struct and enum type support, fixed layout.',
  2: 'Engineering-grade protocol: CRC16 checksum, optional field bitmask, range validation, dedicated validate() functions.',
  3: 'Industrial protocol: TLV encoding, version field, forward compatibility (unknown tags skipped).',
  4: 'Full enterprise protocol: bitfields, discriminated unions, configurable endianness.',
};

const MODULE_GROUPS: { title: string; key: keyof ProtocolModules; level: ProtocolLevel }[] = [
  // Level 1
  { title: 'Protocol Header', key: 'header', level: 1 },
  { title: 'Struct Types', key: 'structTypes', level: 1 },
  { title: 'Enum Types', key: 'enumTypes', level: 1 },
  // Level 2
  { title: 'CRC16 Checksum', key: 'crc', level: 2 },
  { title: 'Optional Fields', key: 'optionalFields', level: 2 },
  { title: 'Range Checks', key: 'rangeChecks', level: 2 },
  { title: 'Validation Functions', key: 'validation', level: 2 },
  // Level 3
  { title: 'TLV Encoding', key: 'tlv', level: 3 },
  { title: 'Version Field', key: 'versionField', level: 3 },
  { title: 'Forward Compatibility', key: 'forwardCompat', level: 3 },
  // Level 4
  { title: 'Bitfields', key: 'bitfields', level: 4 },
  { title: 'Unions', key: 'unions', level: 4 },
  { title: 'Endian Control', key: 'endianControl', level: 4 },
];

function getMinLevel(key: keyof ProtocolModules): number {
  for (const mg of MODULE_GROUPS) {
    if (mg.key === key) return mg.level;
  }
  return 1;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProtocolSettingsDialog({ open, onClose }: Props) {
  const ir = useProtocolStore((s) => s.ir);
  const setLevel = useProtocolStore((s) => s.setLevel);
  const setModules = useProtocolStore((s) => s.setModules);
  const setEndian = useProtocolStore((s) => s.setEndian);

  const modules = resolveModules(ir);

  const handleLevelChange = (v: string) => {
    const level = parseInt(v) as ProtocolLevel;
    setLevel(level);
  };

  const handleModuleToggle = (key: keyof ProtocolModules) => {
    setModules({ [key]: !modules[key] });
  };

  const handleEndianChange = (v: string) => {
    setEndian(v as Endianness);
  };

  const visibleModules = MODULE_GROUPS.filter((mg) => mg.level <= ir.level);

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Protocol Settings</DialogTitle>
          <DialogDescription>
            Configure protocol capability level and features
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Level Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Protocol Level</Label>
            <Select value={String(ir.level)} onValueChange={handleLevelChange}>
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([0, 1, 2, 3, 4] as ProtocolLevel[]).map((l) => (
                  <SelectItem key={l} value={String(l)}>
                    {LEVEL_NAMES[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {LEVEL_DESCRIPTIONS[ir.level]}
            </p>
          </div>

          <Separator />

          {/* Module Toggles */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Modules</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Level {ir.level} enables the following modules. Uncheck to disable a feature.
            </p>
            <div className="space-y-2">
              {visibleModules.map((mg) => {
                const isDefault = LEVEL_DEFAULTS[ir.level][mg.key];
                return (
                  <label
                    key={mg.key}
                    className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={modules[mg.key]}
                      onChange={() => handleModuleToggle(mg.key)}
                      className="rounded border-border accent-foreground"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">{mg.title}</span>
                      {modules[mg.key] !== isDefault && (
                        <span className="ml-2 text-[10px] text-amber-500 font-medium">
                          (overridden)
                        </span>
                      )}
                    </div>
                    {mg.key === 'tlv' && (
                      <span className="text-[10px] text-muted-foreground">tag:1 + len:2 + value</span>
                    )}
                    {mg.key === 'crc' && (
                      <span className="text-[10px] text-muted-foreground">CRC16-CCITT</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Endian (L4+) */}
          {ir.level >= 4 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Byte Order</Label>
                <Select value={ir.endian} onValueChange={handleEndianChange}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="little">Little Endian</SelectItem>
                    <SelectItem value="big">Big Endian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function getLevelShortLabel(level: ProtocolLevel): string {
  return `L${level}`;
}

export function getLevelColor(level: ProtocolLevel): string {
  const colors: Record<ProtocolLevel, string> = {
    0: 'text-zinc-500',
    1: 'text-sky-500',
    2: 'text-emerald-500',
    3: 'text-amber-500',
    4: 'text-rose-500',
  };
  return colors[level];
}
