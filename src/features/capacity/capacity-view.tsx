'use client';

import { useMemo, useState } from 'react';
import { addDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import { ClipboardPaste, Gauge, Layers3 } from 'lucide-react';
import type { WarehouseId } from '@/src/types/planning';
import { WAREHOUSES } from '@/src/types/planning';
import { capacityKey, usePlanningStore } from '@/src/store/planning-store';
import { dayMetrics, numberFormat, percentageFormat } from '@/src/utils/planning';

export function CapacityView({ warehouse }: { warehouse: WarehouseId }) {
  const requests = usePlanningStore((state) => state.requests);
  const capacities = usePlanningStore((state) => state.capacities);
  const setCapacity = usePlanningStore((state) => state.setCapacity);
  const config = usePlanningStore((state) => state.config);
  const [range, setRange] = useState({ warehouse, start: config.planningStart, end: config.planningEnd, value: '20000' });
  const [paste, setPaste] = useState('');
  const dates = useMemo(() => eachDayOfInterval({ start: parseISO(config.planningStart), end: parseISO(config.planningEnd) }).filter((date) => date.getDay() !== 0 && date.getDay() !== 6).map((date) => format(date, 'yyyy-MM-dd')), [config]);

  function applyRange() {
    let date = parseISO(range.start); const end = parseISO(range.end); const value = Number(range.value);
    if (!Number.isFinite(value) || value < 0) return;
    while (date <= end) { if (date.getDay() !== 0 && date.getDay() !== 6) setCapacity(range.warehouse, format(date, 'yyyy-MM-dd'), value); date = addDays(date, 1); }
  }

  function applyPaste() {
    paste.trim().split(/\r?\n/).forEach((line) => {
      const [date, warehouseRaw, capacityRaw] = line.split(/[\t,;|]/).map((value) => value.trim());
      if ((warehouseRaw === '9006' || warehouseRaw === '7002') && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(capacityRaw))) setCapacity(warehouseRaw, date, Number(capacityRaw));
    });
    setPaste('');
  }

  return <section className="mx-auto max-w-[1500px] p-6">
    <div className="mb-5"><p className="eyebrow">Fuente de verdad</p><h2 className="text-2xl font-extrabold">Administrador de capacidad</h2><p className="mt-1 text-sm text-[#65756c]">Ningún día asume capacidad cero ni infinita. Los días no configurados quedan explícitamente sin definir.</p></div>
    <div className="mb-5 grid gap-3 lg:grid-cols-2">
      <article className="rounded-2xl border border-[#d8e2db] bg-white p-5"><div className="mb-4 flex items-center gap-2"><Layers3 size={19} className="text-[#397552]" /><h3 className="font-bold">Aplicar rango</h3></div><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <label className="field-label">Warehouse<select value={range.warehouse} onChange={(event) => setRange({ ...range, warehouse: event.target.value as WarehouseId })} className="field"><option value="9006">9006 · Mini Ticket</option><option value="7002">7002 · Big Ticket</option></select></label>
        <label className="field-label">Desde<input className="field" type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} /></label>
        <label className="field-label">Hasta<input className="field" type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} /></label>
        <label className="field-label">Capacidad diaria<input className="field" type="number" value={range.value} onChange={(event) => setRange({ ...range, value: event.target.value })} /></label>
      </div><button onClick={applyRange} className="mt-4 rounded-xl bg-[#2d6b4c] px-4 py-2 text-sm font-bold text-white">Aplicar a días hábiles</button></article>
      <article className="rounded-2xl border border-[#d8e2db] bg-white p-5"><div className="mb-3 flex items-center gap-2"><ClipboardPaste size={19} className="text-[#397552]" /><h3 className="font-bold">Pegar tabla</h3></div><textarea value={paste} onChange={(event) => setPaste(event.target.value)} className="h-24 w-full rounded-xl border border-[#cedbd2] bg-[#fbfcfb] p-3 text-sm outline-none focus:border-[#4d8161]" placeholder={'fecha\twarehouse\tcapacidad\n2026-09-14\t9006\t25000'} /><button onClick={applyPaste} disabled={!paste.trim()} className="mt-2 rounded-xl border border-[#bfd0c4] px-4 py-2 text-sm font-bold disabled:opacity-40">Incorporar tabla</button></article>
    </div>
    <div className="overflow-hidden rounded-2xl border border-[#d8e2db] bg-white"><div className="flex items-center gap-2 border-b border-[#e1e8e3] p-4"><Gauge size={18} className="text-[#397552]" /><h3 className="font-bold">Detalle diario · {warehouse} {WAREHOUSES[warehouse]}</h3></div><div className="max-h-[540px] overflow-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="sticky top-0 bg-[#f3f7f4] text-xs uppercase tracking-wide text-[#6e7d75]"><tr><th className="p-3">Fecha</th><th className="p-3">Capacidad</th><th className="p-3">Agendado</th><th className="p-3">Disponible</th><th className="p-3">Utilización</th></tr></thead><tbody>{dates.map((date) => { const metrics = dayMetrics(requests, capacities, warehouse, date); return <tr key={date} className="border-t border-[#edf1ee]"><td className="p-3 font-semibold">{date}</td><td className="p-3"><input aria-label={`Capacidad ${date}`} className="w-32 rounded-lg border border-[#cedbd2] px-2 py-1.5 font-semibold" type="number" value={capacities[capacityKey(warehouse, date)] ?? ''} placeholder="Sin definir" onChange={(event) => event.target.value && setCapacity(warehouse, date, Number(event.target.value))} /></td><td className="p-3">{numberFormat.format(metrics.used)}</td><td className="p-3">{metrics.available == null ? '—' : numberFormat.format(metrics.available)}</td><td className="p-3">{metrics.utilization == null ? <span className="status-pill neutral">No definida</span> : <span className={`status-pill ${metrics.utilization > 100 ? 'danger' : metrics.utilization > 90 ? 'warning' : 'success'}`}>{percentageFormat.format(metrics.utilization)}%</span>}</td></tr>; })}</tbody></table></div></div>
  </section>;
}
