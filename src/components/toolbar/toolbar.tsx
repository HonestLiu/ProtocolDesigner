import { useState } from 'react';
import { useProtocolStore } from '@/store/protocol-store';
import { generateC, generatePython, generateRust } from '@/lib/code-generator';
import { FileText, Box, List, Hash, Download, Upload, RotateCcw, Code2, X, Copy, Check, ShieldCheck, Shield } from 'lucide-react';

export function Toolbar() {
  const addMessage = useProtocolStore((s) => s.addMessage);
  const addStruct = useProtocolStore((s) => s.addStruct);
  const addEnum = useProtocolStore((s) => s.addEnum);
  const addField = useProtocolStore((s) => s.addField);
  const ir = useProtocolStore((s) => s.ir);
  const projectName = useProtocolStore((s) => s.projectName);
  const loadProject = useProtocolStore((s) => s.loadProject);
  const resetProject = useProtocolStore((s) => s.resetProject);
  const toggleCrc = useProtocolStore((s) => s.toggleCrc);

  const [showCode, setShowCode] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<'c' | 'python' | 'rust'>('c');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

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

  const handleSave = () => {
    const data = { name: projectName, ir };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      loadProject(data);
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

  return (
    <>
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

        <ToolbarButton onClick={() => handleGenerateCode()} icon={Code2} label="Generate Code" color="" />

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <IconButton onClick={handleSave} icon={Download} title="Save" />
          <IconButton onClick={handleLoad} icon={Upload} title="Load" />
          <IconButton onClick={resetProject} icon={RotateCcw} title="Reset" />
        </div>
      </div>

      {showCode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowCode(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Generated Code</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    toggleCrc();
                    let code = '';
                    const irc = { ...ir, crcEnabled: !ir.crcEnabled };
                    if (codeLanguage === 'c') code = generateC(irc);
                    else if (codeLanguage === 'python') code = generatePython(irc);
                    else code = generateRust(irc);
                    setGeneratedCode(code);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer
                    ${ir.crcEnabled ? 'bg-amber-500/10 text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                  title="Enable CRC16 checksum"
                >
                  {ir.crcEnabled ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                  CRC
                </button>
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
    </>
  );
}
