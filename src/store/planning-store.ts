'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { openDB } from 'idb';
import { mergeSourceRequests } from '@/src/services/source-normalization';
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
  assignNumber: (number: string, date: string | null) => void;
  setCapacity: (warehouse: WarehouseId, date: string, capacity: number) => void;
  replaceCapacities: (capacities: Record<string, number>) => void;
  mergeCapacities: (capacities: Record<string, number>) => void;
  setPriority: (number: string, priority: Priority) => void;
  resetPlanning: () => void;
}

export const capacityKey = (warehouse: WarehouseId, date: string) => `${warehouse}:${date}`;

export const usePlanningStore = create<PlanningState>()(
  persist(
    (set) => ({
      hydrated: false,
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
      assignNumber: (number, date) =>
        set((state) => {
          const current = state.requests.find((request) => request.number === number);
          if (!current) return state;
          const action = date ? (current.fechaDefinitiva ? 'Cambio de fecha' : 'Agendado') : 'Devuelto a pendientes';
          const requests = state.requests.map((request) =>
            request.number !== number
              ? request
              : {
                  ...request,
                  fechaDefinitiva: date,
                  planningStatus: (date ? (request.fechaEnvioOriginal && request.fechaEnvioOriginal !== date ? 'Reprogramado' : 'Agendado') : 'Pendiente') as AgendaRequest['planningStatus'],
                },
          );
          return {
            requests,
            history: [{ timestamp: new Date().toISOString(), number, action, previousValue: current.fechaDefinitiva, newValue: date }, ...state.history],
          };
        }),
      setCapacity: (warehouse, date, capacity) =>
        set((state) => ({ capacities: { ...state.capacities, [capacityKey(warehouse, date)]: capacity } })),
      replaceCapacities: (capacities) => set({ capacities }),
      mergeCapacities: (capacities) => set((state) => ({ capacities: { ...state.capacities, ...capacities } })),
      setPriority: (number, priority) =>
        set((state) => ({
          requests: state.requests.map((request) => request.number === number ? { ...request, priority } : request),
          history: [{ timestamp: new Date().toISOString(), number, action: 'Cambio prioridad', previousValue: state.requests.find((item) => item.number === number)?.priority ?? null, newValue: priority }, ...state.history],
        })),
      resetPlanning: () => set((state) => ({
        requests: state.requests.map((request) => ({ ...request, fechaDefinitiva: null, planningStatus: (request.validationStatus === 'error' ? 'Con problema' : 'Pendiente') as AgendaRequest['planningStatus'], priority: 'Normal' as Priority, planningComment: '' })),
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
