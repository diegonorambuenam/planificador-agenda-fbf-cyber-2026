'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Database, Gauge, RotateCcw, Upload, Warehouse } from 'lucide-react';
import type { WarehouseId } from '@/src/types/planning';
import { loadBundledSample } from '@/src/services/import-service';
import { usePlanningStore } from '@/src/store/planning-store';
import { AgendaBoard } from '@/src/features/agenda/agenda-board';
import { CapacityView } from '@/src/features/capacity/capacity-view';
import { ImportView } from '@/src/features/imports/import-view';

type View = 'agenda' | 'capacity' | 'import';

type ModelContextTool = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

export function PlanningShell() {
  const [view, setView] = useState<View>('agenda');
  const [warehouse, setWarehouse] = useState<WarehouseId>('9006');
  const hydrated = usePlanningStore((state) => state.hydrated);
  const requests = usePlanningStore((state) => state.requests);
  const importRequests = usePlanningStore((state) => state.importRequests);
  const resetPlanning = usePlanningStore((state) => state.resetPlanning);
  const history = usePlanningStore((state) => state.history);

  useEffect(() => {
    if (!hydrated || requests.length) return;
    void loadBundledSample().then(importRequests).catch(() => undefined);
  }, [hydrated, requests.length, importRequests]);

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContextTool }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await modelContext.registerTool({
        name: 'assign_number_to_date',
        title: 'Asignar number a fecha',
        description: 'Agenda un number completo en una fecha definitiva y actualiza la capacidad visible.',
        inputSchema: {
          type: 'object',
          properties: { number: { type: 'string' }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          required: ['number', 'date'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const { number, date } = input as { number?: string; date?: string };
          const state = usePlanningStore.getState();
          const request = state.requests.find((item) => item.number === number);
          if (!request || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Number o fecha inválidos');
          state.assignNumber(request.number, date);
          return { number: request.number, assignedDate: date, status: 'Agendado' };
        },
      }, { signal: lifecycle.signal });
      await modelContext.registerTool({
        name: 'return_number_to_pending',
        title: 'Devolver number a pendientes',
        description: 'Quita la fecha definitiva de un number y lo devuelve a la bandeja de pendientes.',
        inputSchema: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const { number } = input as { number?: string };
          const state = usePlanningStore.getState();
          if (!number || !state.requests.some((item) => item.number === number)) throw new Error('Number no encontrado');
          state.assignNumber(number, null);
          return { number, status: 'Pendiente' };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function confirmReset() {
    if (window.confirm('Se eliminarán fechas definitivas, capacidades y el historial local. El archivo importado se conservará. ¿Continuar?')) resetPlanning();
  }

  return <main className="min-h-screen bg-[#f4f7f4] text-[#17372b]">
    <header className="sticky top-0 z-40 border-b border-[#dce5df] bg-white/95 px-5 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#2d6b4c] text-white"><CalendarDays size={20} /></div><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#6d7f76]">Fulfillment by Falabella</p><h1 className="truncate text-base font-extrabold tracking-tight lg:text-lg">Planificador Definitivo de Agenda FBF</h1></div></div>
        <nav className="hidden items-center gap-1 rounded-xl bg-[#eef3ef] p-1 md:flex">
          <NavButton active={view === 'agenda'} onClick={() => setView('agenda')} icon={<Warehouse size={15} />} label="Agenda semanal" />
          <NavButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={<Gauge size={15} />} label="Capacidad" />
          <NavButton active={view === 'import'} onClick={() => setView('import')} icon={<Upload size={15} />} label="Importar" />
        </nav>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-1.5 text-[11px] font-semibold text-[#6c7d74] xl:flex"><Database size={14} className="text-[#3d7b59]" /> Guardado local · {history.length} cambios</div><button onClick={confirmReset} className="icon-button" title="Reiniciar planificación"><RotateCcw size={16} /></button></div>
      </div>
    </header>
    <div className="border-b border-[#dce5df] bg-white px-4 py-2 md:hidden"><div className="mx-auto flex max-w-[1800px] gap-1"><NavButton active={view === 'agenda'} onClick={() => setView('agenda')} icon={<Warehouse size={15} />} label="Agenda" /><NavButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={<Gauge size={15} />} label="Capacidad" /><NavButton active={view === 'import'} onClick={() => setView('import')} icon={<Upload size={15} />} label="Importar" /></div></div>
    {!hydrated ? <div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-[#6d7c74]">Recuperando planificación local…</div> : view === 'agenda' ? <AgendaBoard warehouse={warehouse} onWarehouseChange={setWarehouse} /> : view === 'capacity' ? <CapacityView warehouse={warehouse} /> : <ImportView onDone={() => setView('agenda')} />}
  </main>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className={"flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition " + (active ? 'bg-white text-[#214f39] shadow-sm' : 'text-[#66776e] hover:text-[#214f39]')}>{icon}{label}</button>;
}
