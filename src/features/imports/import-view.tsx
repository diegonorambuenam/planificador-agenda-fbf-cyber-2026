'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { parseAgendaFile, SOURCE_COLUMNS } from '@/src/services/import-service';
import { usePlanningStore } from '@/src/store/planning-store';
import { numberFormat } from '@/src/utils/planning';
import { isSupabaseConfigured } from '@/src/services/supabase';

export function ImportView({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importRequests = usePlanningStore((state) => state.importRequests);
  const [summary, setSummary] = useState<{ rows: number; numbers: number; sellers: number; units: number; valid: number; problems: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleFile(file?: File) {
    if (!file || isSupabaseConfigured) return;
    setBusy(true); setError('');
    try {
      const requests = await parseAgendaFile(file);
      const problems = requests.filter((request) => request.validationStatus === 'error').length;
      setSummary({
        rows: requests.length,
        numbers: new Set(requests.map((request) => request.number)).size,
        sellers: new Set(requests.map((request) => request.sellerId)).size,
        units: requests.reduce((sum, request) => sum + request.units, 0),
        valid: requests.length - problems,
        problems,
      });
      importRequests(requests);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible leer el archivo.');
    } finally { setBusy(false); }
  }

  if (isSupabaseConfigured) return <section className="mx-auto max-w-5xl p-6"><h2 className="text-2xl font-extrabold">Fuente de solicitudes</h2><p className="mt-3 text-sm">Las solicitudes se reciben desde el extracto privado de Google Sheets mediante Supabase. La importación manual está deshabilitada para no mezclar fuentes.</p><p className="mt-3 text-sm">Se conservan los valores originales y los registros incompletos. Revisa la bandeja Problemas. Actualizar la fuente no cambia tus fechas definitivas ni prioridades.</p><p className="mt-3 text-sm">Consultar última copia solo lee Supabase: no ejecuta consultas en BigQuery.</p></section>;

  return <section className="mx-auto max-w-5xl p-6">
    <div className="mb-6"><p className="eyebrow">Carga de datos</p><h2 className="text-2xl font-extrabold">Importar agenda</h2><p className="mt-1 text-sm text-[#65756c]">La fuente se transforma a un modelo interno antes de entrar a planificación. El archivo original no se modifica.</p></div>
    <button onClick={() => inputRef.current?.click()} className="grid w-full place-items-center rounded-2xl border-2 border-dashed border-[#b9cbbf] bg-white px-6 py-12 text-center transition hover:border-[#4e8162] hover:bg-[#f8fbf9]">
      <UploadCloud size={30} className="mb-3 text-[#3b7956]" /><span className="font-bold">{busy ? 'Procesando archivo…' : 'Seleccionar CSV o Excel'}</span><span className="mt-1 text-sm text-[#718078]">Admite .csv, .xlsx y .xls</span>
    </button>
    <input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void handleFile(event.target.files?.[0])} />
    {error && <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#fff1ea] p-4 text-sm font-semibold text-[#a34d2b]"><AlertTriangle size={18} />{error}</div>}
    {summary && <div className="mt-5 rounded-2xl border border-[#d8e2db] bg-white p-5">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle2 className="text-[#367851]" size={20} /><h3 className="font-bold">Archivo incorporado</h3></div><button onClick={onDone} className="rounded-xl bg-[#2d6b4c] px-4 py-2 text-sm font-bold text-white">Ir a planificar</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-6">{[
        ['Registros', summary.rows], ['Numbers', summary.numbers], ['Sellers', summary.sellers], ['Unidades', numberFormat.format(summary.units)], ['Listos', summary.valid], ['Problemas', summary.problems],
      ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f3f7f4] p-3"><p className="text-xs text-[#708077]">{label}</p><p className="text-lg font-extrabold">{value}</p></div>)}</div>
    </div>}
    <div className="mt-5 rounded-2xl border border-[#d8e2db] bg-white p-5"><div className="flex gap-3"><FileSpreadsheet className="mt-0.5 text-[#49775c]" size={20} /><div><h3 className="font-bold">Columnas reconocidas automáticamente</h3><p className="mt-1 text-sm text-[#718078]">{SOURCE_COLUMNS.join(' · ')}</p><p className="mt-3 text-xs text-[#8a9890]">Los registros incompletos permanecen disponibles para revisión y nunca se eliminan automáticamente.</p></div></div></div>
  </section>;
}
