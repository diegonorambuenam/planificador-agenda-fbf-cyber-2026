'use client';
import { Fragment, useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { AgendaRequest, Priority } from '@/src/types/planning';
import { sourceStatusLabel } from '@/src/services/source-status';
import { displayDate } from '@/src/services/agenda-filters';
import { emptyTableFilters, filterTableRequests, sortTableRequests, type TableSort, type TableFilters } from '@/src/services/agenda-table-data';
import { movementAlerts } from '@/src/services/agenda-movement';
import { validPlanDate } from '@/src/services/shared-planning';
import { dayMetrics, isWithinWindow, numberFormat } from '@/src/utils/planning';
import { usePlanningStore } from '@/src/store/planning-store';
import { ValidationChecks, useValidations } from './validation-context';
import { RequestDetails } from './request-details';

const columns:[TableSort,string][]=[['number','Number'],['sellerName','Seller'],['warehouse','Bodega'],['units','Unidades'],
  ['priority','Prioridad'],['fbf','FBF'],['commercial','Comercial'],['estadoFuente','Estado sistema'],['fechaCreacion','Creado (formulario)'],
  ['fechaEnvioOriginal','Fecha sistema'],['fechaDefinitiva','Fecha planificada FBF'],['planningUpdatedBy','Modificado por'],['planningUpdatedAt','Última modificación']];

export function AgendaTable({requests,filterKey=''}: {requests:AgendaRequest[];filterKey?:string}) {
  const validation=useValidations();
  const ready=usePlanningStore(s=>s.sharedPlanningReady);
  const busy=usePlanningStore(s=>s.planningBusy);
  const save=usePlanningStore(s=>s.savePlanning);
  const [filters,setFilters]=useState<TableFilters>(emptyTableFilters);
  const [sort,setSort]=useState<{key:TableSort;desc:boolean}>({key:'fechaCreacion',desc:true});
  const [pagination,setPagination]=useState({key:'',page:0});
  const [editing,setEditing]=useState<AgendaRequest|null>(null);
  const [date,setDate]=useState('');
  const [priority,setPriority]=useState<Priority>('Normal');
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const sorted=sortTableRequests(filterTableRequests(requests,filters),sort.key,sort.desc,validation.rows,validation.ready);
  const queryKey=JSON.stringify([filterKey,filters,sort]);
  const last=Math.max(0,Math.ceil(sorted.length/50)-1);
  const current=Math.min(pagination.key===queryKey?pagination.page:0,last);
  const visible=sorted.slice(current*50,current*50+50);
  const field=(key:keyof TableFilters,value:string)=>setFilters(old=>({...old,[key]:value}));
  function edit(request:AgendaRequest) {setEditing({...request});setDate(request.fechaDefinitiva??'');setPriority(request.priority);setMessage('');}
  async function submit() {
    if(!editing||busy||!ready) return;
    const planned=date||null;
    if(!validPlanDate(planned)) {setError(true);setMessage('Ingresa una fecha válida entre 2000 y 2100.');return;}
    if(editing.origin==='provisional'&&!planned) {setError(true);setMessage('Las provisorias requieren fecha reservada; puedes eliminarlas en Provisorias.');return;}
    const warnings=movementAlerts(editing);
    if(planned&&planned!==editing.fechaDefinitiva) {
      if(!editing.warehouse) {setError(true);setMessage('Corrige la bodega en Sheets antes de asignar una fecha.');return;}
      const state=usePlanningStore.getState();
      const metrics=dayMetrics(state.requests,state.capacities,editing.warehouse,planned);
      const existing=state.requests.find(row=>row.number===editing.number);
      const projected=metrics.used-(existing?.fechaDefinitiva===planned?existing.units:0)+editing.units;
      if(metrics.capacity==null) warnings.push('No hay capacidad definida para ese día.');
      else if(projected>metrics.capacity) warnings.push(`Quedará sobre capacidad en ${numberFormat.format(projected-metrics.capacity)} unidades.`);
      if(editing.origin!=='provisional'&&!isWithinWindow(editing,planned)) warnings.push('La fecha está fuera de la ventana solicitada.');
    }
    if(warnings.length&&!window.confirm(`${warnings.join('\n\n')}\n\n¿Guardar de todas formas?`)) return;
    const result=await save(editing,planned,priority);
    setError(!!result);setMessage(result??`Agenda ${editing.number} guardada para el equipo.`);
    if(!result) setEditing(null);
  }
  return <section className="overflow-hidden rounded-xl border border-[#d7e0da] bg-white">
    <div className="flex flex-wrap items-end gap-2 border-b p-2">
      <NativeSelect aria-label="Filtrar prioridad" value={filters.priority} onChange={e=>field('priority',e.target.value)}><NativeSelectOption value="all">Prioridad: todas</NativeSelectOption>{(['Alta','Media','Normal'] as const).map(p=><NativeSelectOption key={p}>{p}</NativeSelectOption>)}</NativeSelect>
      {([['createdFrom','Creado desde'],['createdTo','Creado hasta'],['plannedFrom','Planificada desde'],['plannedTo','Planificada hasta']] as const).map(([key,label])=><label key={key} className="text-xs text-[#607168]">{label}<Input className="w-36" aria-label={label} type="date" value={filters[key]} onChange={e=>field(key,e.target.value)}/></label>)}
      <Button size="sm" variant="ghost" onClick={()=>setFilters(emptyTableFilters)}>Limpiar fechas y prioridad</Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2 text-xs"><p>{sorted.length} de {requests.length} solicitudes · con y sin fecha · clic en encabezados para ordenar</p><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={current===0} onClick={()=>setPagination({key:queryKey,page:current-1})}>Anterior</Button><span>{current+1} / {last+1}</span><Button size="sm" variant="outline" disabled={current===last} onClick={()=>setPagination({key:queryKey,page:current+1})}>Siguiente</Button></div></div>
    {!ready&&<p role="status" className="p-2 text-xs text-amber-800">Edición pausada hasta consultar la planificación compartida. Se conserva la última copia.</p>}
    {message&&<p role={error?'alert':'status'} className={`p-2 text-sm ${error?'text-red-700':'text-green-800'}`}>{message}</p>}
    <Table><TableHeader><TableRow>{columns.map(([key,title])=><TableHead key={key} aria-sort={sort.key===key?(sort.desc?'descending':'ascending'):'none'}><Button size="xs" variant="ghost" onClick={()=>setSort(old=>({key,desc:old.key===key?!old.desc:false}))}>{title} <span aria-hidden="true">{sort.key===key?(sort.desc?'↓':'↑'):'↕'}</span></Button></TableHead>)}<TableHead>Acciones</TableHead></TableRow></TableHeader>
      <TableBody>{visible.map((request,index)=><Fragment key={request.number||`missing-${index}`}><TableRow className={request.validationMessages.length||request.sourceAbsent?'bg-amber-50/50':''}>
        <TableCell className="font-bold">{request.number||'Sin number'}{request.origin==='provisional'&&<p className="text-xs font-normal text-amber-800">Provisoria</p>}</TableCell>
        <TableCell className="max-w-48 whitespace-normal break-words">{request.sellerName||'Sin seller'}<p className="text-xs text-[#607168]">{request.sellerId}</p></TableCell>
        <TableCell>{request.warehouse||'Sin bodega'}</TableCell><TableCell>{request.unitsMissing?'Sin informar':numberFormat.format(request.units)}</TableCell><TableCell>{request.priority}</TableCell>
        <TableCell><ValidationChecks request={request} only="fbf"/></TableCell><TableCell><ValidationChecks request={request} only="commercial"/></TableCell><TableCell className="max-w-40 whitespace-normal">{sourceStatusLabel(request)}</TableCell>
        <TableCell>{request.origin==='provisional'?'Sin formulario':request.fechaCreacion||'Sin informar'}</TableCell>
        <TableCell>{displayDate(request.fechaEnvioOriginal)}</TableCell><TableCell>{request.fechaDefinitiva?displayDate(request.fechaDefinitiva):'Sin asignar'}{!request.planningRevision&&request.origin!=='provisional'&&(request.fechaDefinitiva||request.priority!=='Normal')&&<p className="text-xs text-amber-800">Local · guardar para compartir</p>}</TableCell>
        <TableCell>{request.planningUpdatedBy||'Sin registro'}</TableCell><TableCell>{request.planningUpdatedAt?new Date(request.planningUpdatedAt).toLocaleString('es-CL'):'Sin registro previo'}</TableCell>
        <TableCell className="max-w-60 whitespace-normal">{request.validationMessages.length>0&&<p className="text-xs text-amber-800">⚠ {request.validationMessages[0]}</p>}<div className="flex flex-wrap gap-1"><Button size="xs" variant="outline" disabled={!ready||busy||!request.origin||!request.number} onClick={()=>{if(editing&&editing.number!==request.number&&!window.confirm('¿Descartar la edición sin guardar?'))return;edit(request);}}>Editar</Button><RequestDetails request={request}/></div></TableCell>
      </TableRow>{editing?.number===request.number&&<TableRow><TableCell colSpan={14} className="bg-[#edf4ef] whitespace-normal"><form className="flex flex-wrap items-end gap-3 p-1" onSubmit={e=>{e.preventDefault();void submit();}}><label className="text-xs">Fecha planificada FBF<Input type="date" min="2000-01-01" max="2100-12-31" required={editing.origin==='provisional'} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label><label className="text-xs">Prioridad<NativeSelect value={priority} disabled={busy} onChange={e=>setPriority(e.target.value as Priority)}>{(['Normal','Media','Alta'] as const).map(p=><NativeSelectOption key={p}>{p}</NativeSelectOption>)}</NativeSelect></label><Button type="submit" size="sm" disabled={!ready||busy}>{busy?'Guardando…':'Guardar'}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>{setEditing(null);setMessage('');}}>Cancelar</Button><p className="text-xs text-[#607168]">{editing.origin==='provisional'?'Reserva compartida.':'Vacía la fecha para dejar sin asignar.'} No modifica el formulario ni sus validaciones.</p></form></TableCell></TableRow>}</Fragment>)}{!visible.length&&<TableRow><TableCell colSpan={14} className="py-10 text-center">No hay solicitudes con estos filtros.</TableCell></TableRow>}</TableBody>
    </Table>
  </section>;
}
