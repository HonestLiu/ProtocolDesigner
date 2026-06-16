import { useState } from 'react';
import { useProtocolStore } from '@/store/protocol-store';
import { generateC, generatePython, generateRust } from '@/lib/code-generator';
import { FileText, Box, List, Hash, Download, Upload, RotateCcw, Code2, X, Copy, Check, Settings2, ShieldCheck, Tag } from 'lucide-react';
import { ProtocolSettingsDialog, getLevelShortLabel, getLevelColor } from './protocol-settings';
import { resolveModules } from '@/lib/codegen/shared';
import { downloadText, normalizeProjectFile, projectDownloadName } from '@/lib/project-file';

export function Toolbar() {
  const addMessage = useProtocolStore((s) => s.addMessage);
  const addStruct = useProtocolStore((s) => s.addStruct);
  const addEnum = useProtocolStore((s) => s.addEnum);
  const addField = useProtocolStore((s) => s.addField);
  const ir = useProtocolStore((s) => s.ir);
  const projectName = useProtocolStore((s) => s.projectName);
  const loadProject = useProtocolStore((s) => s.loadProject);
  const exportProject = useProtocolStore((s) => s.exportProject);
  const resetProject = useProtocolStore((s) => s.resetProject);

  const [showCode, setShowCode] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<'c' | 'python' | 'rust'>('c');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);

  const modules = resolveModules(ir);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleAddMessage = () => {
    const name = `Msg${Date.now().toString(36).slice(-4).toUpperCase()}`;
    addMessage(name);
  };

  const handleAddStruct = () => {
    const name = `Struct${Date.now().toString(36).slice(-4).toUpperCase()}`;
    addStruct(name);
  };

  const handleAddEnum = () => {
    const name = `Enum${Date.now().toString(36).slice(-4).toUpperCase()}`;
    addEnum(name, { VALUE_0: 0, VALUE_1: 1 });
  };

  const handleAddField = () => {
    const name = `field${Date.now().toString(36).slice(-4)}`;
    addField({ name, type: 'uint8' });
  };

  const handleGenerateCode = (lang?: string) => {
    const l = lang || codeLanguage;
    let code = '';
    if (l === 'c') code = generateC(ir);
    else if (l === 'python') code = generatePython(ir);
    else code = generateRust(ir);
    setGeneratedCode(code);
    setShowCode(true);
  };

  const handleRegenerate = () => {
    let code = '';
    if (codeLanguage === 'c') code = generateC(ir);
    else if (codeLanguage === 'python') code = generatePython(ir);
    else code = generateRust(ir);
    setGeneratedCode(code);
  };

  const saveProjectToFile = async (project: ReturnType<typeof exportProject>, json: string, suggestedName: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let filePath = currentFilePath;

      if (!filePath) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        filePath = await save({
          filters: [{ name: 'Protocol Designer File', extensions: ['pdc'] }],
          defaultPath: projectDownloadName(suggestedName),
        });
        if (!filePath) return;
        setCurrentFilePath(filePath);
      }

      await invoke('save_protocol', { project, path: filePath });
    } catch {
      downloadText(projectDownloadName(suggestedName), json);
    }
  };

  const loadProjectFromData = (value: unknown, fallbackName = projectName) => {
    const project = normalizeProjectFile(value, fallbackName);
    if (!project) {
      throw new Error('Invalid protocol file format.');
    }

    loadProject(project);
    setCurrentFilePath(null);
  };

  const handleSave = async () => {
    const data = exportProject();
    const json = JSON.stringify(data, null, 2);
    await saveProjectToFile(data, json, data.name);
  };

  const handleLoad = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        filters: [{ name: 'Protocol Designer File', extensions: ['pdc', 'json'] }],
        multiple: false,
      });

      if (typeof filePath !== 'string' || !filePath) return;

      const project = await invoke('load_protocol', { path: filePath });
      loadProject(project);
      setCurrentFilePath(filePath);
      return;
    } catch {
      // fall through to browser-style file picker below
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdc,.json';
    input.onchange = async (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      const file = files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadProjectFromData(JSON.parse(text), file.name.replace(/\.[^.]+$/, ''));
      } catch (err) {
        console.error('Failed to load protocol file:', err);
        alert('Failed to load file: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    input.click();
  };

  const ToolbarButton = ({ onClick, icon: Icon, label, color }: {
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    color: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium
        hover:bg-muted hover:text-foreground transition-colors cursor-pointer select-none"
    >
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      {label}
    </button>
  );

  const IconButton = ({ onClick, icon: Icon, title }: {
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center size-8 rounded-lg
        hover:bg-muted hover:text-foreground transition-colors cursor-pointer select-none"
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const levelLabel = getLevelShortLabel(ir.level);
  const levelColor = getLevelColor(ir.level);

  return (
    <>
      {/* Main Toolbar */}
      <div className="h-12 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-4 gap-2 select-none">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold">Protocol Designer</span>
        </div>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1">
          <ToolbarButton onClick={handleAddMessage} icon={FileText} label="Message" color="text-violet-500" />
          <ToolbarButton onClick={handleAddStruct} icon={Box} label="Struct" color="text-emerald-500" />
          <ToolbarButton onClick={handleAddEnum} icon={List} label="Enum" color="text-amber-500" />
          <ToolbarButton onClick={handleAddField} icon={Hash} label="Field" color="text-sky-500" />
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Level indicator badge */}
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-mono font-semibold
            bg-muted/60 hover:bg-muted transition-colors cursor-pointer select-none"
          title="Click to change protocol level"
        >
          <Settings2 className="w-3 h-3 text-muted-foreground" />
          <span className={levelColor}>{levelLabel}</span>
          <span className="text-muted-foreground">
            {ir.level === 0 ? 'Minimal' : ir.level === 1 ? 'Basic' : ir.level === 2 ? 'Engineering' : ir.level === 3 ? 'Industrial' : 'Full'}
          </span>
        </button>

        <ToolbarButton onClick={() => handleGenerateCode()} icon={Code2} label="Generate Code" color="" />

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <IconButton onClick={handleSave} icon={Download} title="Save" />
          <IconButton onClick={handleLoad} icon={Upload} title="Load" />
          <IconButton onClick={() => { resetProject(); setCurrentFilePath(null); }} icon={RotateCcw} title="New" />
        </div>
      </div>

      {/* Generated Code Modal */}
      {showCode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowCode(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Generated Code</h2>
              <div className="flex items-center gap-2">
                {/* Level badge */}
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${levelColor} bg-muted/50`}>
                  {levelLabel}
                </span>
                {/* Settings button */}
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                    text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="Protocol Settings"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Settings
                </button>
                {/* Active module badges */}
                {modules.crc && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500">
                    <ShieldCheck className="w-3 h-3" />CRC
                  </span>
                )}
                {modules.tlv && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-500">
                    <Tag className="w-3 h-3" />TLV
                  </span>
                )}
                {/* Language tabs */}
                <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                  {(['c', 'python', 'rust'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        setCodeLanguage(lang);
                        let code = '';
                        if (lang === 'c') code = generateC(ir);
                        else if (lang === 'python') code = generatePython(ir);
                        else code = generateRust(ir);
                        setGeneratedCode(code);
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer
                        ${codeLanguage === lang ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {lang === 'c' ? 'C' : lang === 'python' ? 'Python' : 'Rust'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCode(false)}
                  className="size-6 rounded-md flex items-center justify-center hover:bg-muted transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-zinc-950 rounded-b-xl relative group">
              <button
                type="button"
                onClick={handleCopy}
                className="absolute top-3 right-3 size-7 rounded-md flex items-center justify-center
                  bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200
                  transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-10"
                title="Copy code"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
                {generatedCode || '// Add messages and click Generate Code'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Protocol Settings Dialog */}
      <ProtocolSettingsDialog
        open={showSettings}
        onClose={() => {
          setShowSettings(false);
          // Regenerate code if modal is open
          if (showCode) handleRegenerate();
        }}
      />
    </>
  );
}
