import type { ProtocolIR, ProtocolProject } from '@/types/protocol';

type ProjectFileShape = Partial<ProtocolProject> & {
  ir?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function looksLikeIR(value: unknown): value is ProtocolIR {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === 'string' &&
    typeof value.level === 'number' &&
    isRecord(value.modules) &&
    typeof value.endian === 'string' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.structs) &&
    Array.isArray(value.enums) &&
    Array.isArray(value.fields)
  );
}

export function normalizeProjectFile(
  value: unknown,
  fallbackName = 'Untitled Protocol'
): ProtocolProject | null {
  if (!isRecord(value)) return null;

  const projectValue = value as ProjectFileShape;

  if (looksLikeIR(projectValue.ir)) {
    const now = new Date().toISOString();
    return {
      name: typeof projectValue.name === 'string' && projectValue.name.trim() ? projectValue.name : fallbackName,
      ir: projectValue.ir,
      version: typeof projectValue.version === 'string' ? projectValue.version : '1.0.0',
      createdAt: typeof projectValue.createdAt === 'string' ? projectValue.createdAt : now,
      updatedAt: typeof projectValue.updatedAt === 'string' ? projectValue.updatedAt : now,
      nodes: Array.isArray(projectValue.nodes) ? projectValue.nodes : undefined,
      edges: Array.isArray(projectValue.edges) ? projectValue.edges : undefined,
    };
  }

  if (looksLikeIR(value)) {
    const now = new Date().toISOString();
    return {
      name: fallbackName,
      ir: value,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    };
  }

  return null;
}

export function projectDownloadName(name: string): string {
  const safeName = name.trim().replace(/\s+/g, '_');
  return `${safeName || 'protocol'}.pdc`;
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}