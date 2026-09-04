'use client';

import { useMemo, useState } from 'react';
import { RequestDetails } from './request-details';
import { ExportAgendasButton } from './export-agendas-button';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { addWeeks, format, getISOWeek, parseISO, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CalendarRange, Check, ChevronLeft, ChevronRight, GripVertical, Layers3, Search, UsersRound } from 'lucide-react';
import type { AgendaRequest, WarehouseId } from '@/src/types/planning';
import { canMoveRequest, movementAlerts } from '@/src/services/agenda-movement';
import { WAREHOUSES } from '@/src/types/planning';
import { capacityKey, usePlanningStore } from '@/src/store/planning-store';
import { dayMetrics, isWithinWindow, numberFormat, percentageFormat, selectedRequests, weekDays } from '@/src/utils/planning';

export function AgendaBoard({ warehouse, onWarehouseChange }: { warehouse: WarehouseId; onWarehouseChange: (warehouse: WarehouseId) => void }) {
  const requests = usePlanningStore((state) => state.requests);
  const capacities = usePlanningStore((state) => state.capacities);
  const assignNumber = usePlanningStore((state) => state.assignNumber);
  const [anchor, setAnchor] = useState(new Date('2026-09-14T12:00:00'));
  const [search, setSearch] = useState('');
  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [tray, setTray] = useState<'pending' | 'problems'>('pending');
  const [grouped, setGrouped] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const days = weekDays(anchor);
  const warehouseRequests = useMemo(() => selectedRequests(requests, warehouse), [requests, warehouse]);
  const pending = warehouseRequests.filter((request) => !request.fechaDefinitiva && !request.sourceAbsent && request.validationStatus !== 'error' && request.planningStatus !== 'Con problema' && request.planningStatus !== 'Rechazado');
  const problems = requests.filter((request) => request.validationStatus === 'error' || request.sourceAbsent);
  const query = search.trim().toLowerCase();
  const visible = (tray === 'pending' ? pending : problems).filter((request) => !query || [request.number, request.sellerId, request.sellerName].some((value) => value.toLowerCase().includes(query)));
  const groups = grouped ? Object.entries(Object.groupBy(visible, (request) => request.sellerName || 'Sin seller')) : [];
  const active = requests.find((request) => request.number === activeNumber) ?? null;

  const week = days.map((day) => dayMetrics(requests, capacities, warehouse, day.date));
  const weekUsed = week.reduce((sum, item) => sum + item.used, 0);
  const weekCapacityDefined = week.every((item) => item.capacity != null);
  const weekCapacity = week.reduce((sum, item) => sum + (item.capacity ?? 0), 0);
  const assignedCount = warehouseRequests.filter((request) => request.fechaDefinitiva).length;
  const totalUnits = warehouseRequests.reduce((sum, request) => sum + request.units, 0);
  const scheduledUnits = warehouseRequests.filter((request) => request.fechaDefinitiva).reduce((sum, request) => sum + request.units, 0);

  function handleDragEnd(event: DragEndEvent) {
    const number = String(event.active.id).replace(/^(number|scheduled):/, '');
    const request = requests.find((item) => item.number === number);
    const target = event.over?.id ? String(event.over.id) : '';
    setActiveNumber(null);
    if (!request || !target || !canMoveRequest(request)) return;
    if (target === 'pending-drop') { assignNumber(number, null); return; }
    if (!target.startsWith('day:')) return;
    if (request.warehouse !== warehouse) {
      window.alert(request.warehouse ? `Selecciona la bodega ${request.warehouse} para mover esta solicitud.` : 'Esta solicitud no tiene una bodega válida. Corrígela en el origen antes de asignarle un día.');
      return;
    }
    const date = target.replace('day:', '');
    if (request.fechaDefinitiva === date) return;
    const metrics = dayMetrics(requests, capacities, warehouse, date);
    const warnings = movementAlerts(request);
    if (metrics.capacity == null) warnings.push('La capacidad de este día no está definida.');
    else if (metrics.used + request.units > metrics.capacity) warnings.push(`La asignación dejará ${numberFormat.format(metrics.used + request.units - metrics.capacity)} unidades sobre capacidad.`);
    if (!isWithinWindow(request, date)) warnings.push(`La fecha está fuera de la ventana ${request.fechaInicio} → ${request.fechaFin}.`);
    if (warnings.length && !window.confirm(`${warnings.join('\n\n')}\n\n¿Quieres continuar?`)) return;
    assignNumber(number, date);
  }

  return <DndContext sensors={sensors} onDragStart={(event: DragStartEvent) => setActiveNumber(String(event.active.id).replace(/^(number|scheduled):/, ''))} onDragCancel={() => setActiveNumber(null)} onDragEnd={handleDragEnd}>
    <section className="mx-auto max-w-[1800px] px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-[#17372b] p-1 text-white">{(Object.keys(WAREHOUSES) as WarehouseId[]).map((id) => <button key={id} onClick={() => onWarehouseChange(id)} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${warehouse === id ? 'bg-[#3d7b59] shadow-sm' : 'text-white/65 hover:text-white'}`}>{id} · {WAREHOUSES[id]}</button>)}</div>
        <div className="flex items-center gap-2"><button aria-label="Semana anterior" onClick={() => setAnchor(addWeeks(anchor, -1))} className="icon-button"><ChevronLeft size={18} /></button><div className="rounded-xl border border-[#d5e0d8] bg-white px-4 py-2 text-sm font-bold">Semana {getISOWeek(anchor)} · {format(startOfWeek(anchor, { weekStartsOn: 1 }), 'd MMM', { locale: es })}</div><button aria-label="Semana siguiente" onClick={() => setAnchor(addWeeks(anchor, 1))} className="icon-button"><ChevronRight size={18} /></button></div>
      </div>

      <ExportAgendasButton requests={requests} />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <Kpi label="Unidades cargadas" value={numberFormat.format(totalUnits)} detail={`${warehouseRequests.length} numbers`} />
        <Kpi label="Unidades agendadas" value={numberFormat.format(scheduledUnits)} detail={`${assignedCount} numbers`} />
        <Kpi label="Unidades pendientes" value={numberFormat.format(totalUnits - scheduledUnits)} detail={`${pending.length} numbers`} />
        <Kpi label="Capacidad visible" value={weekCapacityDefined ? numberFormat.format(weekCapacity) : 'Incompleta'} detail={`Semana ${getISOWeek(anchor)}`} />
        <Kpi label="Disponible" value={weekCapacityDefined ? numberFormat.format(weekCapacity - weekUsed) : '—'} detail={weekCapacityDefined && weekCapacity ? `${percentageFormat.format((weekUsed / weekCapacity) * 100)}% utilizado` : 'Configura capacidad'} />
        <Kpi label="Con problemas" value={String(problems.length)} detail="Revisar datos de origen" alert={problems.length > 0} />
      </div>

      <section className="grid min-h-[650px] grid-cols-1 gap-3 xl:grid-cols-[310px_minmax(0,1fr)]">
        <PendingTray visible={visible} pendingCount={pending.length} problemCount={problems.length} tray={tray} setTray={setTray} search={search} setSearch={setSearch} grouped={grouped} setGrouped={setGrouped} groups={groups} />
        <div className="overflow-hidden rounded-2xl border border-[#d7e0da] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e8e3] px-4 py-3"><div><p className="eyebrow">Semana {getISOWeek(anchor)} · {days[0].label}–{days.at(-1)?.label}</p><p className="text-sm font-bold">{numberFormat.format(weekUsed)} agendadas {weekCapacityDefined ? `de ${numberFormat.format(weekCapacity)}` : '· capacidad incompleta'}</p></div><div className="flex items-center gap-2 text-xs font-semibold text-[#65766d]"><CalendarRange size={16} /> Arrastra un number al día objetivo</div></div>
          <div className="agenda-grid">{days.map((day) => <DayColumn key={day.date} day={day} warehouse={warehouse} requests={requests} capacities={capacities} />)}</div>
        </div>
      </section>
    </section>
    <DragOverlay>{active ? <NumberCard request={active} overlay /> : null}</DragOverlay>
  </DndContext>;
}

function PendingTray({ visible, pendingCount, problemCount, tray, setTray, search, setSearch, grouped, setGrouped, groups }: { visible: AgendaRequest[]; pendingCount: number; problemCount: number; tray: 'pending' | 'problems'; setTray: (value: 'pending' | 'problems') => void; search: string; setSearch: (value: string) => void; grouped: boolean; setGrouped: (value: boolean) => void; groups: [string, AgendaRequest[] | undefined][] }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pending-drop' });
  return <aside ref={setNodeRef} className={`flex max-h-[690px] flex-col overflow-hidden rounded-2xl border bg-white transition ${isOver ? 'border-[#3e7d59] ring-4 ring-[#dcecdf]' : 'border-[#d7e0da]'}`}>
    <div className="border-b border-[#e1e8e3] p-3"><div className="grid grid-cols-2 gap-1 rounded-lg bg-[#eff4f0] p-1"><button onClick={() => setTray('pending')} className={`rounded-md px-2 py-1.5 text-xs font-bold ${tray === 'pending' ? 'bg-white shadow-sm' : 'text-[#718078]'}`}>Pendientes · {pendingCount}</button><button onClick={() => setTray('problems')} className={`rounded-md px-2 py-1.5 text-xs font-bold ${tray === 'problems' ? 'bg-white text-[#a4512d] shadow-sm' : 'text-[#718078]'}`}>Problemas · {problemCount}</button></div><label className="mt-3 flex items-center gap-2 rounded-lg border border-[#d7e0da] px-3 py-2 text-sm text-[#77857d]"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Number, seller o ID" /></label><label className="mt-3 flex items-center justify-between text-xs font-semibold text-[#607168]">Agrupar por seller<input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} className="size-4 accent-[#34744f]" /></label></div>
    <div className="space-y-2 overflow-y-auto p-3">{grouped ? groups.map(([seller, items]) => <div key={seller}><div className="mb-2 flex items-center justify-between text-[12px] font-extrabold uppercase tracking-wide text-[#73827a]"><span>{seller}</span><span>{items?.length} numbers</span></div>{items?.map((request) => <NumberCard key={request.number || Math.random()} request={request} />)}</div>) : visible.map((request) => <NumberCard key={request.number || `${request.sellerId}-${request.fechaCreacion}`} request={request} />)}{visible.length === 0 && <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-[#d7e0da] p-4 text-center text-xs text-[#7c8a83]"><span><Check className="mx-auto mb-2" size={20} />No hay registros en esta bandeja</span></div>}</div>
  </aside>;
}

function DayColumn({ day, warehouse, requests, capacities }: { day: { date: string; day: string; label: string }; warehouse: WarehouseId; requests: AgendaRequest[]; capacities: Record<string, number> }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` });
  const metrics = dayMetrics(requests, capacities, warehouse, day.date);
  const status = metrics.utilization == null ? 'neutral' : metrics.utilization > 100 ? 'danger' : metrics.utilization > 90 ? 'warning' : metrics.utilization > 70 ? 'high' : 'success';
  return <section ref={setNodeRef} className={`day-column ${isOver ? 'is-over' : ''} ${status === 'danger' ? 'is-danger' : ''}`}><header className="border-b border-[#e1e8e3] bg-white p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-extrabold capitalize">{day.day} <span className="font-semibold text-[#718078]">{day.label}</span></h2>{metrics.utilization == null ? <span className="status-pill neutral">Sin definir</span> : <span className={`status-pill ${status}`}>{percentageFormat.format(metrics.utilization)}%</span>}</div>{metrics.capacity == null ? <div className="mt-3 rounded-lg bg-[#f2f4f2] px-2 py-2 text-[12px] font-bold text-[#718078]">Capacidad no definida</div> : <><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5ece7]"><div className={`capacity-fill ${status}`} style={{ width: `${Math.min(metrics.utilization ?? 0, 100)}%` }} /></div><p className="mt-2 text-[12px] font-bold">{numberFormat.format(metrics.used)} / {numberFormat.format(metrics.capacity)}</p><p className={`text-[12px] ${metrics.available! < 0 ? 'font-bold text-[#b34f2d]' : 'text-[#74837b]'}`}>{metrics.available! < 0 ? `${numberFormat.format(Math.abs(metrics.available!))} sobre capacidad` : `${numberFormat.format(metrics.available!)} disponibles`}</p></>}<div className="mt-2 flex gap-3 text-[12px] text-[#7a8881]"><span>{metrics.assigned.length} numbers</span><span>{metrics.sellers} sellers</span></div></header><div className="space-y-2 p-2">{metrics.assigned.map((request) => <NumberCard key={request.number} request={request} compact />)}<div className="grid min-h-20 place-items-center rounded-xl border border-dashed border-[#ccd8d0] text-center text-[12px] font-semibold text-[#8a9990]"><span><Layers3 className="mx-auto mb-1" size={15} />Soltar aquí</span></div></div></section>;
}

function NumberCard({ request, compact = false, overlay = false }: { request: AgendaRequest; compact?: boolean; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${overlay ? 'overlay' : compact ? 'scheduled' : 'number'}:${request.number}`, disabled: overlay || !canMoveRequest(request) });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const within = request.fechaDefinitiva ? isWithinWindow(request, request.fechaDefinitiva) : true;
  return <article ref={setNodeRef} style={style} {...listeners} {...attributes} className={`number-card ${compact ? 'compact' : ''} ${overlay ? 'overlay' : ''} ${isDragging ? 'opacity-30' : ''} ${request.validationStatus === 'error' || request.sourceAbsent || request.planningStatus === 'Con problema' ? 'problem' : ''}`}><div className="flex items-start gap-2"><GripVertical className="mt-0.5 shrink-0 text-[#9bad9f]" size={15} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="break-words text-sm font-bold">{request.number || 'SIN NUMBER'}</p>{request.priority !== 'Normal' && <span className={`priority ${request.priority.toLowerCase()}`}>{request.priority}</span>}</div>{request.origin === 'provisional' && <p className="mt-1 text-[12px] font-bold text-amber-700">PROVISORIA · editar en Provisorias</p>}{request.origin === 'sheet' && <p className="mt-1 text-[12px] font-bold text-[#4f735f]">FORMULARIO{request.promotedFromProvisional ? ' · reserva conservada' : ''}</p>}<p className="mt-1 break-words text-sm text-[#66776e]">{request.sellerName || 'Seller sin nombre'}</p><div className="mt-2 flex items-end justify-between gap-2"><p className="text-sm font-extrabold">{request.unitsMissing ? '—' : numberFormat.format(request.units)} <span className="text-[12px] font-medium text-[#7c8b83]">uds</span></p>{request.validationStatus === 'error' ? <AlertTriangle size={14} className="text-[#b45331]" /> : <p className={`text-[12px] font-bold ${within ? 'text-[#4f735f]' : 'text-[#b45331]'}`}>{request.fechaInicio?.slice(5)} → {request.fechaFin?.slice(5)}</p>}</div>{request.validationMessages.length > 0 && <p className="mt-2 text-[12px] font-semibold text-[#a84f2e]">{request.validationMessages[0]}</p>}{!overlay && <RequestDetails request={request} />}</div></div></article>;
}

function Kpi({ label, value, detail, alert = false }: { label: string; value: string; detail: string; alert?: boolean }) {
  return <article className="rounded-xl border border-[#dce5df] bg-white p-3"><p className="text-[12px] font-bold uppercase tracking-wide text-[#718078]">{label}</p><p className={`mt-1 text-xl font-extrabold ${alert ? 'text-[#b25431]' : ''}`}>{value}</p><p className="text-[12px] text-[#7b8981]">{detail}</p></article>;
}
