'use client';

import { useMemo, useState } from 'react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { sourceStatusLabel, sourceStatusOptions } from '@/src/services/source-status';
import { filterAgendaRequests, displayDate, type AgendaFilters } from '@/src/services/agenda-filters';
import { RequestDetails } from './request-details';
import { ExportAgendasButton } from './export-agendas-button';
import { AgendaTable } from './agenda-table';
import { ValidationProvider, ValidationChecks, useValidations } from './validation-context';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { addWeeks, getISOWeek } from 'date-fns';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, GripVertical, Layers3, Search } from 'lucide-react';
import type { AgendaRequest, WarehouseId } from '@/src/types/planning';
import { canMoveRequest, movementAlerts } from '@/src/services/agenda-movement';
import { WAREHOUSES } from '@/src/types/planning';
import { usePlanningStore } from '@/src/store/planning-store';
import { dayMetrics, isWithinWindow, numberFormat, percentageFormat, selectedRequests, weekDays } from '@/src/utils/planning';

export function AgendaBoard(props: { warehouse: WarehouseId; onWarehouseChange: (warehouse: WarehouseId) => void }) {
  return <ValidationProvider><AgendaWorkspace {...props}/></ValidationProvider>;
}

function AgendaWorkspace({ warehouse, onWarehouseChange }: { warehouse: WarehouseId; onWarehouseChange: (warehouse: WarehouseId) => void }) {
  const requests = usePlanningStore(state => state.requests);
  const capacities = usePlanningStore(state => state.capacities);
  const assignNumber = usePlanningStore(state => state.assignNumber);
  const planningReady = usePlanningStore(state => state.sharedPlanningReady);
  const planningBusy = usePlanningStore(state => state.planningBusy);
  const [planningMessage,setPlanningMessage] = useState('');
  const validation = useValidations();
  const [anchor,setAnchor] = useState(new Date('2026-09-14T12:00:00'));
  const [mode,setMode] = useState<'calendar'|'table'>('calendar');
  const [tableWarehouse,setTableWarehouse] = useState('all');
  const [filters,setFilters] = useState<AgendaFilters>({search:'',sourceStatus:'all',fbf:'all',commercial:'all',planned:'all'});
  const [activeNumber,setActiveNumber] = useState<string|null>(null);
  const [grouped,setGrouped] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}));
  const days=weekDays(anchor);
  const warehouseRequests=useMemo(()=>selectedRequests(requests,warehouse),[requests,warehouse]);
  const pending=warehouseRequests.filter(request=>!request.fechaDefinitiva);
  const problems=warehouseRequests.filter(request=>request.validationStatus==='error'||request.sourceAbsent);
  const scoped=mode==='table' ? requests.filter(request=>tableWarehouse==='all'||request.warehouse===tableWarehouse) : requests.filter(request=>request.warehouse===warehouse||!request.warehouse);
  const visible=filterAgendaRequests(scoped,{...filters,planned:mode==='calendar'?'all':filters.planned},validation.rows,validation.ready);
  const trayRequests=visible.filter(request=>!request.fechaDefinitiva);
  const statusOptions=sourceStatusOptions(requests);
  const active=requests.find(request=>request.number===activeNumber)??null;
  const week=days.map(day=>dayMetrics(requests,capacities,warehouse,day.date));
  const weekUsed=week.reduce((sum,item)=>sum+item.used,0);
  const weekCapacityDefined=week.every(item=>item.capacity!=null);
  const weekCapacity=week.reduce((sum,item)=>sum+(item.capacity??0),0);
  const assignedCount=warehouseRequests.filter(request=>request.fechaDefinitiva).length;
  const totalUnits=warehouseRequests.reduce((sum,request)=>sum+request.units,0);
  const scheduledUnits=warehouseRequests.filter(request=>request.fechaDefinitiva).reduce((sum,request)=>sum+request.units,0);
  const setFilter=(key:keyof AgendaFilters,value:string)=>setFilters(old=>({...old,[key]:value}));

  async function handleDragEnd(event: DragEndEvent) {
    const number = String(event.active.id).replace(/^(number|scheduled):/, '');
    const request = requests.find((item) => item.number === number);
    const target = event.over?.id ? String(event.over.id) : '';
    setActiveNumber(null);
    if (!request || !target || !canMoveRequest(request)) return;
    if(!planningReady||planningBusy) {setPlanningMessage('Espera a consultar la planificación compartida antes de mover.');return;}
    if (target === 'pending-drop') { setPlanningMessage(await assignNumber(number, null)??'Cambio guardado para el equipo.'); return; }
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
    setPlanningMessage(await assignNumber(number, date)??'Cambio guardado para el equipo.');
  }


  return <DndContext sensors={sensors} onDragStart={(event:DragStartEvent)=>setActiveNumber(String(event.active.id).replace(/^(number|scheduled):/,''))} onDragCancel={()=>setActiveNumber(null)} onDragEnd={handleDragEnd}>
    <section className="mx-auto max-w-[1800px] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-[#d7e0da] bg-white p-2">
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[#17372b] p-1 text-white">{(Object.keys(WAREHOUSES) as WarehouseId[]).map(id=><Button key={id} size="sm" variant="ghost" aria-pressed={warehouse===id} onClick={()=>onWarehouseChange(id)} className={warehouse===id?'bg-[#3d7b59] text-white':'text-white/80'}>{id} · {WAREHOUSES[id]}</Button>)}</div>
        <div className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-[#e1e8e3] lg:grid-cols-6" aria-label={`Indicadores de bodega ${warehouse}, sin filtros`}>
          <Kpi label="Cargadas" value={numberFormat.format(totalUnits)} detail={`${warehouseRequests.length} numbers`}/>
          <Kpi label="Agendadas" value={numberFormat.format(scheduledUnits)} detail={`${assignedCount} numbers`}/>
          <Kpi label="Pendientes" value={numberFormat.format(totalUnits-scheduledUnits)} detail={`${pending.length} numbers`}/>
          <Kpi label="Capacidad semanal" value={weekCapacityDefined?numberFormat.format(weekCapacity):'Incompleta'} detail={`Semana ${getISOWeek(anchor)}`}/>
          <Kpi label="Disponible semanal" value={weekCapacityDefined?numberFormat.format(weekCapacity-weekUsed):'—'} detail={`Bodega ${warehouse}`}/>
          <Kpi label="Con alertas" value={String(problems.length)} detail="Datos de origen" alert={problems.length>0}/>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-white p-0.5" aria-label="Vista">
          <Button size="sm" variant={mode==='calendar'?'default':'ghost'} aria-pressed={mode==='calendar'} onClick={()=>setMode('calendar')}>Calendario</Button>
          <Button size="sm" variant={mode==='table'?'default':'ghost'} aria-pressed={mode==='table'} onClick={()=>setMode('table')}>Tabla</Button>
        </div>
        {mode==='calendar'?<div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" aria-label="Semana anterior" onClick={()=>setAnchor(addWeeks(anchor,-1))}><ChevronLeft/></Button><span className="text-xs font-bold">S{getISOWeek(anchor)} · {days[0].label}–{days.at(-1)?.label}</span><Button size="icon-sm" variant="outline" aria-label="Semana siguiente" onClick={()=>setAnchor(addWeeks(anchor,1))}><ChevronRight/></Button></div>:
          <NativeSelect aria-label="Bodega en tabla" value={tableWarehouse} onChange={event=>setTableWarehouse(event.target.value)}><NativeSelectOption value="all">Todas las bodegas</NativeSelectOption><NativeSelectOption value="9006">9006</NativeSelectOption><NativeSelectOption value="7002">7002</NativeSelectOption><NativeSelectOption value="">Sin bodega</NativeSelectOption></NativeSelect>}
        <label className="flex h-8 w-48 items-center gap-1 rounded-lg border bg-white px-2"><Search size={14}/><input aria-label="Buscar number o seller" className="min-w-0 w-full text-sm outline-none" placeholder="Number / seller" value={filters.search} onChange={event=>setFilter('search',event.target.value)}/></label>
        <NativeSelect aria-label="Estado de Google Sheets" title="Estado de Google Sheets" value={filters.sourceStatus} onChange={event=>setFilter('sourceStatus',event.target.value)} className="max-w-52"><NativeSelectOption value="all">Estado: todos</NativeSelectOption>{statusOptions.map(option=><NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}{filters.sourceStatus!=='all'&&!statusOptions.some(option=>option.value===filters.sourceStatus)&&<NativeSelectOption value={filters.sourceStatus}>Estado sin solicitudes</NativeSelectOption>}</NativeSelect>
        {(['fbf','commercial'] as const).map(kind=><NativeSelect key={kind} aria-label={kind==='fbf'?'Validación FBF':'Validación comercial'} value={filters[kind]} onChange={event=>setFilter(kind,event.target.value)}><NativeSelectOption value="all">{kind==='fbf'?'FBF':'Comercial'}: todos</NativeSelectOption><NativeSelectOption value="approved">Validado</NativeSelectOption><NativeSelectOption value="pending">Pendiente</NativeSelectOption></NativeSelect>)}
        {mode==='table'&&<NativeSelect aria-label="Fecha planificada" value={filters.planned} onChange={event=>setFilter('planned',event.target.value)}><NativeSelectOption value="all">Agenda: todas</NativeSelectOption><NativeSelectOption value="assigned">Con fecha</NativeSelectOption><NativeSelectOption value="pending">Sin fecha</NativeSelectOption></NativeSelect>}
        <Button size="sm" variant="ghost" onClick={()=>setFilters({search:'',sourceStatus:'all',fbf:'all',commercial:'all',planned:'all'})}>Limpiar</Button>
        <div className="ml-auto"><ExportAgendasButton requests={requests} /></div>
      </div>
      {validation.error&&<p role="status" className="mb-2 text-xs text-amber-800">{validation.error}</p>}
      {planningMessage&&<p role="status" className="mb-2 text-xs text-[#607168]">{planningMessage}</p>}
      {planningBusy&&<p role="status" className="mb-2 text-xs">Guardando planificación compartida…</p>}
      {mode==='table'?<AgendaTable requests={visible} filterKey={JSON.stringify([filters,tableWarehouse])}/>:<section className="grid min-h-[600px] grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)]">
        <PendingTray visible={trayRequests} grouped={grouped} setGrouped={setGrouped}/>
        <div className="overflow-x-auto rounded-xl border border-[#d7e0da] bg-white">
          <div className="flex flex-wrap justify-between gap-2 border-b px-3 py-2 text-xs text-[#607168]"><span>Arrastra un number al día objetivo</span><span>Ocupación e indicadores totales, sin filtros</span></div>
          <div className="agenda-grid">{days.map(day=><DayColumn key={day.date} day={day} warehouse={warehouse} requests={requests} capacities={capacities} visibleRequests={visible}/>)}</div>
        </div>
      </section>}
    </section>
    <DragOverlay>{active?<NumberCard request={active} overlay/>:null}</DragOverlay>
  </DndContext>;
}

function PendingTray({visible,grouped,setGrouped}:{visible:AgendaRequest[];grouped:boolean;setGrouped:(value:boolean)=>void}) {
  const {setNodeRef,isOver}=useDroppable({id:'pending-drop'});
  const groups=grouped?Object.entries(Object.groupBy(visible,request=>request.sellerName||'Sin seller')):[['',visible] as const];
  return <aside ref={setNodeRef} className={`flex max-h-[750px] flex-col overflow-hidden rounded-xl border bg-white ${isOver?'ring-2 ring-[#3e7d59]':'border-[#d7e0da]'}`}>
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2"><h2 className="text-sm font-bold">Sin asignar · {visible.length}</h2><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={grouped} onChange={event=>setGrouped(event.target.checked)}/>Agrupar</label></div>
    <div className="overflow-y-auto p-2">{groups.map(([seller,items])=><div key={seller}>{grouped&&<h3 className="mb-2 text-xs font-bold">{seller} · {items?.length}</h3>}{items?.map((request,index)=><NumberCard key={request.number||`${request.sellerId}-${index}`} request={request}/>)}</div>)}{!visible.length&&<p className="p-6 text-center text-sm text-[#607168]">No hay solicitudes sin asignar con estos filtros.</p>}</div>
  </aside>;
}

function DayColumn({ day, warehouse, requests, capacities, visibleRequests }: { visibleRequests: AgendaRequest[]; day: { date: string; day: string; label: string }; warehouse: WarehouseId; requests: AgendaRequest[]; capacities: Record<string, number> }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` });
  const metrics = dayMetrics(requests, capacities, warehouse, day.date);
  const status = metrics.utilization == null ? 'neutral' : metrics.utilization > 100 ? 'danger' : metrics.utilization > 90 ? 'warning' : metrics.utilization > 70 ? 'high' : 'success';
  return <section ref={setNodeRef} className={`day-column ${isOver ? 'is-over' : ''} ${status === 'danger' ? 'is-danger' : ''}`}><header className="border-b border-[#e1e8e3] bg-white p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-extrabold capitalize">{day.day} <span className="font-semibold text-[#718078]">{day.label}</span></h2>{metrics.utilization == null ? <span className="status-pill neutral">Sin definir</span> : <span className={`status-pill ${status}`}>{percentageFormat.format(metrics.utilization)}%</span>}</div>{metrics.capacity == null ? <div className="mt-3 rounded-lg bg-[#f2f4f2] px-2 py-2 text-[12px] font-bold text-[#718078]">Capacidad no definida</div> : <><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5ece7]"><div className={`capacity-fill ${status}`} style={{ width: `${Math.min(metrics.utilization ?? 0, 100)}%` }} /></div><p className="mt-2 text-[12px] font-bold">{numberFormat.format(metrics.used)} / {numberFormat.format(metrics.capacity)}</p><p className={`text-[12px] ${metrics.available! < 0 ? 'font-bold text-[#b34f2d]' : 'text-[#74837b]'}`}>{metrics.available! < 0 ? `${numberFormat.format(Math.abs(metrics.available!))} sobre capacidad` : `${numberFormat.format(metrics.available!)} disponibles`}</p></>}<div className="mt-2 flex gap-3 text-[12px] text-[#7a8881]"><span>{metrics.assigned.length} numbers</span><span>{metrics.sellers} sellers</span></div></header><div className="space-y-2 p-2">{metrics.assigned.filter(request => visibleRequests.includes(request)).map((request) => <NumberCard key={request.number} request={request} compact />)}<div className="grid min-h-20 place-items-center rounded-xl border border-dashed border-[#ccd8d0] text-center text-[12px] font-semibold text-[#8a9990]"><span><Layers3 className="mx-auto mb-1" size={15} />Soltar aquí</span></div></div></section>;
}

function NumberCard({ request, compact = false, overlay = false }: { request: AgendaRequest; compact?: boolean; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${overlay ? 'overlay' : compact ? 'scheduled' : 'number'}:${request.number}`, disabled: overlay || !canMoveRequest(request) });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return <article ref={setNodeRef} style={style} {...listeners} {...attributes} className={`number-card ${compact ? 'compact' : ''} ${overlay ? 'overlay' : ''} ${isDragging ? 'opacity-30' : ''} ${request.validationStatus === 'error' || request.sourceAbsent || request.planningStatus === 'Con problema' ? 'problem' : ''}`}><div className="flex items-start gap-2"><GripVertical className="mt-0.5 shrink-0 text-[#9bad9f]" size={15} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="break-words text-sm font-bold">{request.number || 'SIN NUMBER'}</p>{request.priority !== 'Normal' && <span className={`priority ${request.priority.toLowerCase()}`}>{request.priority}</span>}</div>{request.origin === 'provisional' && <p className="mt-1 text-[12px] font-bold text-amber-700">PROVISORIA · editar en Provisorias</p>}{request.origin === 'sheet' && <p className="mt-1 text-[12px] font-bold text-[#4f735f]">FORMULARIO{request.promotedFromProvisional ? ' · reserva conservada' : ''}</p>}<div className="mt-2"><ValidationChecks request={request} disabled={overlay}/></div><p className="mt-2 rounded-md border border-[#c9d9ce] bg-[#edf4ef] px-2 py-1 text-xs font-semibold break-words"><span className="text-[#607168]">Estado sistema: </span>{sourceStatusLabel(request)}</p><p className="mt-1 text-xs text-[#607168]">Fecha sistema: <strong>{displayDate(request.fechaEnvioOriginal)}</strong></p><p className="mt-1 break-words text-sm text-[#66776e]">{request.sellerName || 'Seller sin nombre'}</p><div className="mt-2 flex items-end justify-between gap-2"><p className="text-sm font-extrabold">{request.unitsMissing ? '—' : numberFormat.format(request.units)} <span className="text-[12px] font-medium text-[#7c8b83]">uds</span></p>{request.validationStatus === 'error' && <AlertTriangle size={14} className="text-[#b45331]" />}</div>{request.validationMessages.length > 0 && <p className="mt-2 text-[12px] font-semibold text-[#a84f2e]">{request.validationMessages[0]}</p>}{!overlay && <RequestDetails request={request} />}</div></div></article>;
}

function Kpi({ label, value, detail, alert = false }: { label: string; value: string; detail: string; alert?: boolean }) {
  return <article className="min-w-0 px-2 py-1"><p className="text-[11px] font-bold text-[#607168]">{label}</p><p className={`text-lg font-bold ${alert ? 'text-[#b25431]' : ''}`}>{value}</p><p className="text-[11px] text-[#607168]">{detail}</p></article>;
}
