import { useRef, useState } from 'react';
import { Upload, Download, FileJson } from 'lucide-react';
import { useAtlasStore } from '../store';
import { jsonToDataset } from '../schema/adapters/json';
import { csvToDataset } from '../schema/adapters/csv';
import { ValidationError } from '../schema/validate';

export default function DataLoader() {
  const setDataset = useAtlasStore(s => s.setDataset);
  const setLoadError = useAtlasStore(s => s.setLoadError);
  const loadError = useAtlasStore(s => s.loadError);
  const resetFilters = useAtlasStore(s => s.resetFilters);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = async (file: File) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const text = await file.text();
      const dataset = file.name.endsWith('.csv')
        ? csvToDataset(text, { autoCategorize: true })
        : jsonToDataset(text);
      setDataset(dataset);
      const allLabels: string[] = [];
      for (const p of dataset.points) {
        if (p.label) allLabels.push(`${p.category}::${p.label}`);
      }
      resetFilters(dataset.categories.map(c => c.id), allLabels);
    } catch (e) {
      if (e instanceof ValidationError) {
        setLoadError(e.issues.join('\n'));
      } else {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <div className="absolute top-32 left-8 z-20 pointer-events-auto flex flex-col gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isLoading}
          className="px-3.5 py-2 text-[10px] tracking-[0.22em] uppercase border border-slate-700/60 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-all font-mono flex items-center gap-2 disabled:opacity-50"
        >
          <Upload size={11} /> {isLoading ? 'Loading...' : 'Load JSON / CSV'}
        </button>
        <a
          href="data:application/json;charset=utf-8,%7B%0A%20%20%22categories%22%3A%20%5B%7B%22id%22%3A%20%22a%22%2C%20%22label%22%3A%20%22A%22%2C%20%22color%22%3A%20%22%23ff6b6b%22%7D%5D%2C%0A%20%20%22points%22%3A%20%5B%7B%22id%22%3A%200%2C%20%22x%22%3A%201%2C%20%22y%22%3A%200%2C%20%22z%22%3A%200%2C%20%22category%22%3A%20%22a%22%7D%5D%0A%7D"
          download="atlas-template.json"
          className="px-3.5 py-2 text-[10px] tracking-[0.22em] uppercase border border-slate-800/60 text-slate-500 hover:border-slate-600 hover:text-slate-300 transition-all font-mono flex items-center gap-2"
        >
          <Download size={11} /> Template
        </a>
      </div>

      {loadError && (
        <div className="absolute top-32 right-8 z-30 max-w-md pointer-events-auto bg-red-950/95 border border-red-500/40 p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileJson size={14} className="text-red-400" />
              <span className="text-[10px] tracking-[0.22em] uppercase text-red-300 font-mono">Load Failed</span>
            </div>
            <button onClick={() => setLoadError(null)} className="text-red-400 hover:text-red-200">×</button>
          </div>
          <pre className="text-[11px] text-red-200 whitespace-pre-wrap font-mono leading-relaxed">{loadError}</pre>
        </div>
      )}
    </>
  );
}
