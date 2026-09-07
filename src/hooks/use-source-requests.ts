import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient, CAPACITY_EVENT_ID } from '@/src/services/supabase';
import { parsePlannerSnapshot } from '@/src/services/planner-snapshot';
import { usePlanningStore } from '@/src/store/planning-store';
import { planningSync } from '@/src/services/shared-planning';


export function useSourceRequests(userId: string | undefined, enabled: boolean) {
  const hydrated = usePlanningStore(state => state.hydrated);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState({ busy: false, message: 'Esperando conexión con la fuente', refreshedAt: '', count: 0 });
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    usePlanningStore.getState().setSharedPlanningReady(false);
    if (!enabled || !userId || !hydrated) return;
    const client = getSupabaseClient();
    if (!client) return;
    let cancelled = false;
    let inFlight = false;
    async function load() {
      if (inFlight || cancelled || planningSync.busy) return;
      const epoch=planningSync.epoch;
      inFlight = true;
      setStatus(old => ({ ...old, busy: true }));
      try {
        const { data, error } = await client!.rpc('fbf_planner_snapshot', { p_event_id: CAPACITY_EVENT_ID });
        if (cancelled || epoch!==planningSync.epoch || planningSync.busy) return;
        if (error) throw error;
        const { requests, source: snapshot, sharedPlanningReady } = parsePlannerSnapshot(data);
        usePlanningStore.getState().importRequests(requests);
        usePlanningStore.getState().setSharedPlanningReady(sharedPlanningReady);
        if (!snapshot) {
          setStatus({ busy: false, message: 'Provisorias compartidas. Esperando la primera sincronización de Sheets.', refreshedAt: '', count: 0 });
          return;
        }
        const stale = Date.now() - Date.parse(snapshot.source_refreshed_at) > 2 * 60 * 60 * 1000;
        setStatus({ busy: false, count: snapshot.row_count, refreshedAt: snapshot.source_refreshed_at,
          message: stale ? 'Fuente desactualizada: se conserva la última copia. Revisar Sheets y el script.' : 'Solicitudes sincronizadas desde Sheets' });
      } catch {
        if (!cancelled) {usePlanningStore.getState().setSharedPlanningReady(false);setStatus(old => ({ ...old, busy: false, message: 'No se pudo consultar la fuente. Se conserva la última copia; edición pausada hasta reconectar.' }));}
      } finally { inFlight = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); usePlanningStore.getState().setSharedPlanningReady(false); };
  }, [enabled, userId, hydrated, revision]);
  return { ...status, refresh };
}
