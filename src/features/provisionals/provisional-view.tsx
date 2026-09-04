'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePlanningStore } from '@/src/store/planning-store';
import { saveProvisional, deleteProvisional, type ProvisionalInput } from '@/src/services/provisional-service';
import type { AgendaRequest, Priority, WarehouseId } from '@/src/types/planning';
import { dayMetrics, numberFormat } from '@/src/utils/planning';

const empty = (warehouse: WarehouseId): ProvisionalInput => ({number:'',seller_id:'',seller:'',warehouse,units:0,planned_date:'',priority:'Normal',comment:''});
export function ProvisionalView({warehouse,refresh,enabled}: {warehouse:WarehouseId;refresh:()=>void;enabled:boolean}) {
  const requests=usePlanningStore(s=>s.requests);
  const capacities=usePlanningStore(s=>s.capacities);
  const [form,setForm]=useState<ProvisionalInput>(()=>empty(warehouse));
  const [editing,setEditing]=useState<AgendaRequest|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const rows=requests.filter(r=>r.origin==='provisional');
  const metric=dayMetrics(requests,capacities,form.warehouse,form.planned_date);
  const oldUnits=editing && editing.warehouse===form.warehouse && editing.fechaDefinitiva===form.planned_date ? editing.units : 0;
  const projected=metric.used-oldUnits+(Number.isFinite(form.units)?form.units:0);
  function field<K extends keyof ProvisionalInput>(key:K,value:ProvisionalInput[K]) {setForm(old=>({...old,[key]:value}));}
  function edit(row:AgendaRequest) {
    setEditing({...row});setMessage('');
    setForm({number:row.number,seller_id:row.sellerId,seller:row.sellerName,warehouse:row.warehouse as WarehouseId,
      units:row.units,planned_date:row.fechaDefinitiva??'',priority:row.priority,comment:row.planningComment});
  }
  async function submit(event:FormEvent) {
    event.preventDefault(); if(busy||!enabled) return;
    const duplicate=requests.find(r=>r.number===form.number.trim() && (!editing || r.number!==editing.number));
    if(duplicate) {setError(true);setMessage('Este number ya existe. No se creará una segunda solicitud.');return;}
    if(!Number.isInteger(form.units)||form.units<=0) {setError(true);setMessage('Ingresa unidades enteras mayores que cero.');return;}
    const warning=metric.capacity==null?'No hay capacidad definida para ese día.':projected>metric.capacity?`Quedará sobre capacidad en ${numberFormat.format(projected-metric.capacity)} unidades.`:'';
    if(warning&&!window.confirm(warning+' ¿Guardar la reserva provisoria de todas formas?')) return;
    setBusy(true);setMessage('');
    const result=await saveProvisional({...form,number:form.number.trim(),seller:form.seller.trim()},editing?.provisionalRevision??null);
    setBusy(false);setError(!!result.error);setMessage(result.error??'Provisoria guardada para el equipo. Actualizando la lista…');
    refresh();
    if(!result.error){setEditing(null);setForm(empty(warehouse));}
  }
  async function remove(row:AgendaRequest) {
    if(busy||!enabled||row.origin!=='provisional'||!row.provisionalRevision) return;
    if(!window.confirm(`¿Borrar la provisoria ${row.number} para todo el equipo? Se liberará su reserva. Las solicitudes del formulario no se pueden borrar.`))return;
    setBusy(true);setMessage('');
    const result=await deleteProvisional(row.number,row.provisionalRevision);
    setBusy(false);setError(!!result.error);setMessage(result.error??'Provisoria eliminada. Actualizando la lista…');refresh();
    if(!result.error&&editing?.number===row.number){setEditing(null);setForm(empty(warehouse));}
  }
  return <section className="mx-auto max-w-6xl space-y-5 p-5">
    <div><p className="eyebrow">Reservas del equipo</p><h2 className="text-2xl font-extrabold">Agendas provisorias</h2><p className="mt-2 text-sm text-[#65756c]">Se comparten entre los tres y descuentan capacidad. Usa el mismo number que llegará al formulario: se convertirá en oficial sin duplicarse, conservando la fecha reservada.</p><p className="mt-1 text-xs text-[#65756c]">Solo las provisorias se pueden editar o borrar aquí. Las de Sheets quedan protegidas, incluso si luego desaparecen del extracto.</p></div>
    {!enabled&&<p role="alert">Conecta con Supabase para crear o modificar reservas compartidas.</p>}
    <form onSubmit={submit} className="rounded-2xl border border-[#d7e0da] bg-white p-5">
      <h3 className="mb-4 font-bold">{editing?'Editar provisoria':'Nueva provisoria'}</h3>
      <fieldset disabled={busy||!enabled} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="prov-number">Number</Label><Input id="prov-number" required maxLength={200} disabled={!!editing} value={form.number} onChange={e=>field('number',e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="prov-seller">Seller</Label><Input id="prov-seller" required maxLength={300} value={form.seller} onChange={e=>field('seller',e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="prov-id">ID seller (opcional)</Label><Input id="prov-id" maxLength={200} value={form.seller_id} onChange={e=>field('seller_id',e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="prov-units">Unidades</Label><Input id="prov-units" type="number" required min={1} max={1000000000} step={1} value={form.units||''} onChange={e=>field('units',Number(e.target.value))} /></div>
        <div className="space-y-2"><Label htmlFor="prov-date">Fecha reservada</Label><Input id="prov-date" type="date" required min="2000-01-01" max="2100-12-31" value={form.planned_date} onChange={e=>field('planned_date',e.target.value)} /></div>
        <div className="space-y-2"><p className="text-sm font-medium">Warehouse</p><div className="flex gap-2" role="group" aria-label="Warehouse">{(['9006','7002'] as WarehouseId[]).map(w=><Button type="button" key={w} variant={form.warehouse===w?'default':'outline'} aria-pressed={form.warehouse===w} onClick={()=>field('warehouse',w)}>{w}</Button>)}</div></div>
        <div className="space-y-2"><p className="text-sm font-medium">Prioridad</p><div className="flex gap-2" role="group" aria-label="Prioridad">{(['Normal','Media','Alta'] as Priority[]).map(p=><Button type="button" key={p} variant={form.priority===p?'default':'outline'} aria-pressed={form.priority===p} onClick={()=>field('priority',p)}>{p}</Button>)}</div></div>
        <div className="space-y-2"><Label htmlFor="prov-comment">Comentario</Label><Textarea id="prov-comment" maxLength={2000} value={form.comment} onChange={e=>field('comment',e.target.value)} /></div>
        <p className="text-xs md:col-span-2">{form.planned_date?`Ocupación proyectada: ${numberFormat.format(projected)} uds · Capacidad: ${metric.capacity==null?'sin definir':numberFormat.format(metric.capacity)}. Incluye las reservas compartidas y tu agenda local visible.`:'Selecciona una fecha para consultar capacidad.'}</p>
        <div className="flex gap-2"><Button type="submit">{busy?'Guardando…':editing?'Guardar cambios':'Crear provisoria'}</Button>{editing&&<Button type="button" variant="outline" onClick={()=>{setEditing(null);setForm(empty(warehouse));}}>Cancelar edición</Button>}</div>
      </fieldset>
    </form>
    {message&&<p role={error?'alert':'status'} className={error?'text-sm text-red-700':'text-sm text-[#2d6b4c]'}>{message}</p>}
    <div className="flex items-center justify-between"><h3 className="font-bold">Provisorias activas · {rows.length}</h3><Button variant="outline" onClick={refresh} disabled={busy}>Actualizar lista</Button></div>
    {!rows.length&&<p className="rounded-xl border border-dashed p-6 text-sm text-[#65756c]">No hay provisorias activas en la última copia consultada.</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row=><article key={row.number} className="rounded-xl border border-[#d7e0da] bg-white p-4"><span className="text-xs font-bold text-amber-700">PROVISORIA · COMPARTIDA</span><h4 className="mt-1 font-bold break-all">{row.number} · {row.sellerName}</h4><p className="mt-2 text-sm">{row.fechaDefinitiva} · {row.warehouse} · {numberFormat.format(row.units)} uds · {row.priority}</p>{row.planningComment&&<p className="mt-2 whitespace-pre-wrap break-words text-xs">{row.planningComment}</p>}<div className="mt-3 flex gap-2"><Button variant="outline" disabled={busy||!enabled} onClick={()=>edit(row)}>Editar</Button><Button variant="destructive" disabled={busy||!enabled} onClick={()=>void remove(row)}>Borrar provisoria</Button></div></article>)}</div>
  </section>;
}
