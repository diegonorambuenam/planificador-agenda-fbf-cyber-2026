'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Cloud, Database, Gauge, LogOut, RotateCcw, Upload, Warehouse } from 'lucide-react';
import { TeamAccessForm } from '@/src/components/team-access-form';
import type { WarehouseId } from '@/src/types/planning';
import { usePlanningStore } from '@/src/store/planning-store';
import { AgendaBoard } from '@/src/features/agenda/agenda-board';
import { CapacityView } from '@/src/features/capacity/capacity-view';
import { ImportView } from '@/src/features/imports/import-view';
import { useSharedCapacities } from '@/src/hooks/use-shared-capacities';
import { useSourceRequests } from '@/src/hooks/use-source-requests';
import { Button } from '@/components/ui/button';
import { ProvisionalView } from '@/src/features/provisionals/provisional-view';

type View = 'agenda' | 'capacity' | 'import' | 'provisionals';

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
  const resetPlanning = usePlanningStore((state) => state.resetPlanning);
  const history = usePlanningStore((state) => state.history);
  const shared = useSharedCapacities();
  const source = useSourceRequests(shared.session?.user.id, shared.authorized === true);

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
          if (request.origin === 'provisional') throw new Error('Edita la fecha compartida desde Provisorias');
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
          if (state.requests.find(item => item.number === number)?.origin === 'provisional') throw new Error('Edita o elimina esta reserva desde Provisorias');
          state.assignNumber(number, null);
          return { number, status: 'Pendiente' };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function confirmReset() {
    if (window.confirm('Se eliminarán las fechas definitivas y el historial local. Las capacidades y provisorias compartidas se conservarán. ¿Continuar?')) resetPlanning();
  }

  if (shared.configured && (!shared.initialized || (shared.session && shared.authorized == null))) {
    return <AccessScreen title="Conectando con Supabase" description="Estamos validando tu sesión y recuperando las capacidades del equipo." />;
  }

  if (shared.configured && !shared.session) {
    return <AccessScreen title="Acceso equipo FBF" description="Ingresa con tu usuario. Si es tu primera vez, utiliza el código privado que te entregó el administrador.">
      <TeamAccessForm key="login" pending={false} message={shared.message} signIn={shared.signIn} activate={shared.activate} />
    </AccessScreen>;
  }

  if (shared.configured && shared.account?.pending) {
    return <AccessScreen title="Crea tu contraseña" description={`Activa el acceso de ${shared.account.username}. El código se utilizará una sola vez.`}>
      <TeamAccessForm key="activation" pending message={shared.message} signIn={shared.signIn} activate={shared.activate} />
      <button className="mt-4 text-sm underline" onClick={() => void shared.signOut()}>Cancelar y salir</button>
    </AccessScreen>;
  }

  if (shared.configured && shared.authorized === false) {
    return <AccessScreen title="Sesión sin acceso" description={shared.message || 'Este usuario no tiene acceso.'}><button onClick={() => void shared.signOut()} className="mt-6 rounded-xl border border-[#bfd0c4] px-4 py-2 text-sm font-bold">Volver a ingresar</button></AccessScreen>;
  }

  return <main className="min-h-screen bg-[#f4f7f4] text-[#17372b]">
    <header className="sticky top-0 z-40 border-b border-[#dce5df] bg-white/95 px-5 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#2d6b4c] text-white"><CalendarDays size={20} /></div><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#6d7f76]">Fulfillment by Falabella</p><h1 className="truncate text-base font-extrabold tracking-tight lg:text-lg">Planificador Definitivo de Agenda FBF</h1></div></div>
        <nav className="hidden items-center gap-1 rounded-xl bg-[#eef3ef] p-1 md:flex">
          <NavButton active={view === 'agenda'} onClick={() => setView('agenda')} icon={<Warehouse size={15} />} label="Agenda semanal" />
          <NavButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={<Gauge size={15} />} label="Capacidad" />
          <NavButton active={view === 'import'} onClick={() => setView('import')} icon={<Upload size={15} />} label="Importar" />
          <NavButton active={view === 'provisionals'} onClick={() => setView('provisionals')} icon={<CalendarDays size={15} />} label="Provisorias" />
        </nav>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-1.5 text-[11px] font-semibold text-[#6c7d74] xl:flex">{shared.configured ? <><Cloud size={14} className="text-[#3d7b59]" /> Supabase · {shared.session?.user.email}</> : <><Database size={14} className="text-[#3d7b59]" /> Modo local · {history.length} cambios</>}</div>{shared.configured && <button onClick={() => void shared.signOut()} className="icon-button" title="Cerrar sesión"><LogOut size={16} /></button>}<button onClick={confirmReset} className="icon-button" title="Reiniciar planificación"><RotateCcw size={16} /></button></div>
      </div>
    </header>
    {shared.configured && <section className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs" aria-live="polite">
      <div><p className="font-bold">{source.message}</p><p className="mt-1 text-[#65756c]">{source.refreshedAt && `${source.count} solicitudes · Fuente actualizada: ${new Date(source.refreshedAt).toLocaleString('es-CL')} · `}Solicitudes, capacidades y provisorias compartidas. La edición posterior de fechas y prioridades de solicitudes oficiales sigue siendo local.</p></div>
      <Button variant="outline" size="sm" disabled={source.busy} onClick={source.refresh}>{source.busy ? 'Consultando…' : 'Consultar última copia'}</Button>
    </section>}
    <div className="border-b border-[#dce5df] bg-white px-4 py-2 md:hidden"><div className="mx-auto flex max-w-[1800px] gap-1"><NavButton active={view === 'agenda'} onClick={() => setView('agenda')} icon={<Warehouse size={15} />} label="Agenda" /><NavButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={<Gauge size={15} />} label="Capacidad" /><NavButton active={view === 'import'} onClick={() => setView('import')} icon={<Upload size={15} />} label="Importar" /><NavButton active={view === 'provisionals'} onClick={() => setView('provisionals')} icon={<CalendarDays size={15} />} label="Provisorias" /></div></div>
    {!hydrated ? <div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-[#6d7c74]">Recuperando planificación local…</div> : view === 'agenda' ? <AgendaBoard warehouse={warehouse} onWarehouseChange={setWarehouse} /> : view === 'capacity' ? <CapacityView warehouse={warehouse} saveCapacities={shared.saveCapacities} syncMessage={shared.configured ? shared.message : 'Modo local: configura Supabase para compartir los cambios'} syncStatus={shared.status} /> : view === 'provisionals' ? <ProvisionalView warehouse={warehouse} refresh={source.refresh} enabled={shared.authorized === true} /> : <ImportView onDone={() => setView('agenda')} />}
  </main>;
}

function AccessScreen({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#f4f7f4] p-6 text-[#17372b]"><section className="w-full max-w-md rounded-3xl border border-[#d8e2db] bg-white p-8 text-center shadow-[0_24px_70px_rgba(31,72,52,.10)]"><div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-[#2d6b4c] text-white"><Cloud size={25} /></div><p className="eyebrow">Planificador FBF</p><h1 className="mt-2 text-2xl font-extrabold">{title}</h1><p className="mt-2 text-sm leading-6 text-[#65756c]">{description}</p>{children}</section></main>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className={"flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition " + (active ? 'bg-white text-[#214f39] shadow-sm' : 'text-[#66776e] hover:text-[#214f39]')}>{icon}{label}</button>;
}
