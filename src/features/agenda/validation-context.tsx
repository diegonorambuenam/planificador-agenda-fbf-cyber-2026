'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSupabaseClient, CAPACITY_EVENT_ID } from '@/src/services/supabase';
import { parseValidations, validationKey, type ValidationKind, type ValidationMap } from '@/src/services/preagenda-validation';
import { Button } from '@/components/ui/button';
import type { AgendaRequest } from '@/src/types/planning';

interface ValidationState {
  rows: ValidationMap; ready: boolean; error: string; busy: Record<string, boolean>;
  save: (number: string, kind: ValidationKind, approved: boolean) => Promise<void>;
}
const Context = createContext<ValidationState>({rows:{},ready:false,error:'',busy:{},save:async()=>{}});
export const useValidations = () => useContext(Context);

export function ValidationProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<ValidationMap>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const version = useRef(0);
  const live = useRef(true);
  const inMutation = useRef(false);
  useEffect(() => {
    live.current = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight || inMutation.current) return;
      inFlight = true;
      const current = ++version.current;
      try {
        const client = getSupabaseClient();
        if (!client) throw new Error('Supabase required');
        const { data, error } = await client.rpc('fbf_validation_snapshot', {p_event_id: CAPACITY_EVENT_ID});
        if (error) throw error;
        const parsed = parseValidations(data);
        if (live.current && current === version.current) { setRows(parsed); setReady(true); setError(''); }
      } catch {
        if (live.current && current === version.current) { setReady(false); setError('Validaciones no disponibles. Reintentando conexión con Supabase…'); }
      } finally { inFlight = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { live.current = false; ++version.current; window.clearInterval(timer); };
  }, []);
  async function save(number: string, kind: ValidationKind, approved: boolean) {
    if (!ready || inMutation.current) return;
    const key = validationKey(number, kind);
    inMutation.current = true;
    ++version.current;
    setBusy({[key]:true}); setError('');
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase required');
      const {data,error} = await client.rpc('fbf_set_validation',{p_event_id:CAPACITY_EVENT_ID,p_number:number,p_kind:kind,p_approved:approved,p_revision:rows[key]?.revision ?? null});
      if (error) throw error;
      const parsed = parseValidations([data]);
      if (live.current) setRows(previous => ({...previous,...parsed}));
    } catch {
      if (live.current) { setReady(false); setError('No se confirmó la validación. Se consultará la última copia antes de reintentar.'); }
    } finally { ++version.current; inMutation.current=false; if(live.current)setBusy({}); }
  }
  return <Context.Provider value={{rows,ready,error,busy,save}}>{children}</Context.Provider>;
}

export function ValidationChecks({request, disabled = false, only}: {request:AgendaRequest;disabled?:boolean;only?:ValidationKind}) {
  const state = useValidations();
  return <div className="flex flex-wrap gap-1" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    {(only?[only]:['fbf','commercial'] as const).map(kind=>{
      const row=state.rows[validationKey(request.number,kind)];
      const approved=state.ready && row?.approved===true;
      const label=kind==='fbf'?'FBF':'Comercial';
      const title=!state.ready?'Esperando validaciones compartidas':row?`${label}: ${row.approved?'validada':'pendiente'} · ${row.updated_by??'Equipo'} · ${new Date(row.updated_at).toLocaleString('es-CL')}`:`${label}: pendiente de validación`;
      return <Button key={kind} size="xs" variant="outline" aria-pressed={approved} title={title}
        className={approved?'border-green-300 bg-green-50 text-green-800':'text-[#607168]'}
        disabled={disabled || !state.ready || Object.keys(state.busy).length>0 || !request.number || !request.origin}
        onClick={()=>{if(approved&&!window.confirm(`¿Devolver la validación ${label} de ${request.number} a pendiente?`))return;void state.save(request.number,kind,!approved);}}>
        {approved?'✓':'○'} {label}{!state.ready?' · …':approved?' validado':' pendiente'}
      </Button>;
    })}
  </div>;
}
