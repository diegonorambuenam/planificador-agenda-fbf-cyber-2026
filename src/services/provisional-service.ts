import { CAPACITY_EVENT_ID, getSupabaseClient } from './supabase';
import type { Priority, WarehouseId } from '@/src/types/planning';
import { planningSync } from './shared-planning';

export interface ProvisionalInput {
  number: string; seller_id: string; seller: string; warehouse: WarehouseId;
  units: number; planned_date: string; priority: Priority; comment: string;
}
function message(code?: string, detail?: string) {
  if (code==='40001') return 'Otro integrante cambió o eliminó la provisoria. Actualiza la lista y vuelve a abrirla.';
  if (detail?.startsWith('FORMULARIO:')) return 'Este number ya llegó desde Sheets: no se puede editar ni borrar como provisoria. Actualiza la lista.';
  if (code==='42501') return 'Debes iniciar sesión con un usuario autorizado del equipo.';
  if (code?.startsWith('22') || code?.startsWith('23')) return 'Revisa los datos: unidades enteras positivas y una fecha válida.';
  return 'No se confirmó el cambio en Supabase. Consulta la última copia antes de reintentar.';
}
export async function saveProvisional(row: ProvisionalInput, revision: string|null) {
  const client=getSupabaseClient();
  if(!client) return {error:'Se requiere conexión con Supabase.'};
  if(planningSync.busy) return {error:'Espera a que termine el guardado actual.'};
  planningSync.busy=true; ++planningSync.epoch;
  try {
    const {data,error}=await client.rpc('fbf_save_provisional',{p_event_id:CAPACITY_EVENT_ID,p_row:row,p_revision:revision});
    return {error:error?message(error.code,error.message):data?.ok===true?null:message()};
  } catch { return {error:message()}; }
  finally { ++planningSync.epoch; planningSync.busy=false; }
}
export async function deleteProvisional(number: string, revision: string) {
  const client=getSupabaseClient();
  if(!client) return {error:'Se requiere conexión con Supabase.'};
  if(planningSync.busy) return {error:'Espera a que termine el guardado actual.'};
  planningSync.busy=true; ++planningSync.epoch;
  try {
    const {data,error}=await client.rpc('fbf_delete_provisional',{p_event_id:CAPACITY_EVENT_ID,p_number:number,p_revision:revision});
    return {error:error?message(error.code,error.message):data?.ok===true?null:message()};
  } catch { return {error:message()}; }
  finally { ++planningSync.epoch; planningSync.busy=false; }
}
