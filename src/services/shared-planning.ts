import type { AgendaRequest, Priority } from '@/src/types/planning';

export interface SharedPlan {
  number: string; origin: 'sheet'|'provisional'; planned_date: string|null; priority: Priority;
  revision: string; updated_at: string; updated_by: string|null;
}
export function validPlanDate(value: string|null): boolean {
  if(value===null) return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31') return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function parseSharedPlans(value: unknown): SharedPlan[] {
  if(!Array.isArray(value)) throw new Error('Invalid shared plans');
  const seen=new Set<string>();
  for(const p of value) {
    if(!p||typeof p.number!=='string'||!p.number||seen.has(p.number)||!['sheet','provisional'].includes(p.origin)||
      !(p.planned_date===null||typeof p.planned_date==='string')||!validPlanDate(p.planned_date)||
      (p.origin==='provisional'&&p.planned_date===null)||!['Normal','Media','Alta'].includes(p.priority)||
      typeof p.revision!=='string'||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(p.revision)||
      typeof p.updated_at!=='string'||!Number.isFinite(Date.parse(p.updated_at))||
      !(p.updated_by===null||typeof p.updated_by==='string')) throw new Error('Invalid shared plan');
    seen.add(p.number);
  }
  return value;
}
export function applySharedPlan(request:AgendaRequest, plan:SharedPlan):AgendaRequest {
  if(request.number!==plan.number||request.origin!==plan.origin) throw new Error('Planning identity changed');
  return {...request,fechaDefinitiva:plan.planned_date,priority:plan.priority,planningRevision:plan.revision,
    ...(plan.origin==='provisional'?{provisionalRevision:plan.revision,fechaInicio:plan.planned_date!,fechaFin:plan.planned_date!}:{}),
    planningUpdatedAt:plan.updated_at,planningUpdatedBy:plan.updated_by,
    planningStatus:plan.planned_date?(request.fechaEnvioOriginal&&request.fechaEnvioOriginal!==plan.planned_date?'Reprogramado':'Agendado'):'Pendiente'};
}
// A snapshot started before a mutation must never roll back its acknowledged result.
export const planningSync = { epoch:0, busy:false };
