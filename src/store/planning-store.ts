'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { openDB } from 'idb';
import { mergeSourceRequests } from '@/src/services/source-normalization';
import { applySharedPlan, parseSharedPlans, planningSync, validPlanDate } from '@/src/services/shared-planning';
import { CAPACITY_EVENT_ID, getSupabaseClient } from '@/src/services/supabase';
import type { AgendaRequest, ChangeLog, EventConfig, Priority, WarehouseId } from '@/src/types/planning';

const storage = {
  async getItem(name: string) {
    const db = await openDB('fbf-planner', 1, { upgrade(database) { database.createObjectStore('state'); } });
    return (await db.get('state', name)) ?? null;
  },
  async setItem(name: string, value: string) {
    const db = await openDB('fbf-planner', 1, { upgrade(database) { if (!database.objectStoreNames.contains('state')) database.createObjectStore('state'); } });
    await db.put('state', value, name);
  },
  async removeItem(name: string) {
    const db = await openDB('fbf-planner', 1);
    await db.delete('state', name);
  },
};

interface PlanningState {
  hydrated: boolean;
  requests: AgendaRequest[];
  capacities: Record<string, number>;
  history: ChangeLog[];
  config: EventConfig;
  setHydrated: (value: boolean) => void;
  importRequests: (requests: AgendaRequest[]) => void;
  sharedPlanningReady: boolean;
  planningBusy: boolean;
  setSharedPlanningReady: (ready: boolean) => void;
  savePlanning: (request: AgendaRequest, date: string|null, priority: Priority) => Promise<string|null>;
  assignNumber: (number: string, date: string | null) => Promise<string|null>;
  setCapacity: (warehouse: WarehouseId, date: string, capacity: number) => void;
  replaceCapacities: (capacities: Record<string, number>) => void;
  mergeCapacities: (capacities: Record<string, number>) => void;
  setPriority: (number: string, priority: Priority) => Promise<string|null>;
  resetPlanning: () => void;
}

export const capacityKey = (warehouse: WarehouseId, date: string) => `${warehouse}:${date}`;

export const usePlanningStore = create<PlanningState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      sharedPlanningReady: false,
      planningBusy: false,
      setSharedPlanningReady: (sharedPlanningReady) => set({sharedPlanningReady}),
      requests: [],
      capacities: {},
      history: [],
      config: {
        name: 'Cyber Octubre 2026',
        cyberStart: '2026-10-05',
        cyberEnd: '2026-10-07',
        planningStart: '2026-09-07',
        planningEnd: '2026-10-02',
      },
      setHydrated: (hydrated) => set({ hydrated }),
      importRequests: (incoming) => set((state) => {
        const requests = mergeSourceRequests(state.requests, incoming);
        const retained = new Set(requests.map(row => row.number));
        const removed = new Set(state.requests.filter(row => !retained.has(row.number)).map(row => row.number));
        return { requests, history: state.history.filter(entry => !removed.has(entry.number)) };
      }),
      savePlanning: async (request, date, priority) => {
        if(!get().sharedPlanningReady||planningSync.busy) return 'Espera a consultar la última copia compartida.';
        if(!request.origin||!request.number) return 'Esta solicitud no está compartida en Supabase.';
        if(!validPlanDate(date)||!['Normal','Media','Alta'].includes(priority)) return 'Revisa la fecha y la prioridad.';
        if(request.origin==='provisional'&&!date) return 'La provisoria requiere una fecha reservada. Puedes borrarla desde Provisorias.';
        const client=getSupabaseClient();
        if(!client) return 'Se requiere conexión con Supabase.';
        planningSync.busy=true; ++planningSync.epoch; set({planningBusy:true});
        try {
          const {data,error}=await client.rpc('fbf_set_plan',{p_event_id:CAPACITY_EVENT_ID,p_number:request.number,
            p_date:date,p_priority:priority,p_origin:request.origin,
            p_revision:request.origin==='provisional'?request.provisionalRevision??null:request.planningRevision??null});
          if(error) {
            set({sharedPlanningReady:false});
            return error.code==='40001'?'Otro integrante modificó esta agenda. Consulta la última copia y vuelve a abrir Editar.':
              'No se confirmó el cambio en Supabase. Consulta la última copia antes de reintentar.';
          }
          const [plan]=parseSharedPlans([data]);
          if(plan.number!==request.number||plan.origin!==request.origin) throw new Error('Wrong planning response');
          set(state=>({requests:state.requests.map(row=>row.number===plan.number&&row.origin===plan.origin?applySharedPlan(row,plan):row)}));
          return null;
        } catch {
          set({sharedPlanningReady:false});
          return 'No se confirmó el cambio. Consulta la última copia antes de reintentar.';
        } finally {++planningSync.epoch;planningSync.busy=false;set({planningBusy:false});}
      },
      assignNumber: async (number,date) => {
        const request=get().requests.find(row=>row.number===number);
        if(!request||request.origin==='provisional') return 'Edita esta reserva desde la tabla o Provisorias.';
        return get().savePlanning(request,date,request.priority);
      },
      setCapacity: (warehouse, date, capacity) =>
        set((state) => ({ capacities: { ...state.capacities, [capacityKey(warehouse, date)]: capacity } })),
      replaceCapacities: (capacities) => set({ capacities }),
      mergeCapacities: (capacities) => set((state) => ({ capacities: { ...state.capacities, ...capacities } })),
      setPriority: async (number, priority) => {
        const request=get().requests.find(row=>row.number===number);
        return request?get().savePlanning(request,request.fechaDefinitiva,priority):'Solicitud no encontrada';
      },
      resetPlanning: () => set((state) => ({
        requests: state.requests.map((request) => request.planningRevision || request.origin === 'provisional' ? request : ({ ...request, fechaDefinitiva: null, planningStatus: (request.validationStatus === 'error' ? 'Con problema' : 'Pendiente') as AgendaRequest['planningStatus'], priority: 'Normal' as Priority, planningComment: '' })),
        history: [],
      })),
    }),
    {
      name: 'planning-v1',
      storage: createJSONStorage(() => storage),
      partialize: ({ requests, capacities, history, config }) => ({ requests, capacities, history, config }),
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);
