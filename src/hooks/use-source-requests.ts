import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient, CAPACITY_EVENT_ID } from '@/src/services/supabase';
import { normalizeRows, SOURCE_COLUMNS, type RawRow } from '@/src/services/source-normalization';
import { usePlanningStore } from '@/src/store/planning-store';

interface Snapshot {
  source_refreshed_at: string;
  received_at: string;
  row_count: number;
  rows: { source: RawRow; present: boolean }[];
}

export function useSourceRequests(userId: string | undefined, enabled: boolean) {
  const hydrated = usePlanningStore(state => state.hydrated);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState({ busy: false, message: 'Esperando conexión con la fuente', refreshedAt: '', count: 0 });
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !userId || !hydrated) return;
    const client = getSupabaseClient();
    if (!client) return;
    let cancelled = false;
    let inFlight = false;
    async function load() {
      if (inFlight || cancelled) return;
      inFlight = true;
      setStatus(old => ({ ...old, busy: true }));
      try {
        const { data, error } = await client!.rpc('fbf_requests_snapshot', { p_event_id: CAPACITY_EVENT_ID });
        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          setStatus({ busy: false, message: 'Esperando la primera sincronización de Sheets. Los registros locales se conservan.', refreshedAt: '', count: 0 });
          return;
        }
        const snapshot = data as Snapshot;
        if (!Array.isArray(snapshot.rows) || !Number.isInteger(snapshot.row_count) || snapshot.row_count < 1 ||
            !Number.isFinite(Date.parse(snapshot.source_refreshed_at)) || !Number.isFinite(Date.parse(snapshot.received_at)) ||
            snapshot.rows.some(row => !row || typeof row.present !== 'boolean' || !row.source ||
              SOURCE_COLUMNS.some(column => !(column in row.source)) || typeof row.source.number !== 'string' || !row.source.number.trim()) ||
            snapshot.rows.filter(row => row.present).length !== snapshot.row_count ||
            new Set(snapshot.rows.map(row => String(row.source.number).trim())).size !== snapshot.rows.length) {
          throw new Error('Invalid snapshot');
        }
        const requests = normalizeRows(snapshot.rows.map(row => row.source));
        requests.forEach((request, index) => {
          if (!snapshot.rows[index].present) {
            request.sourceAbsent = true;
            if (request.validationStatus !== 'error') request.validationStatus = 'warning';
            request.validationMessages.push('No está en la última extracción; registro conservado');
          }
        });
        usePlanningStore.getState().importRequests(requests);
        const stale = Date.now() - Date.parse(snapshot.source_refreshed_at) > 2 * 60 * 60 * 1000;
        setStatus({ busy: false, count: snapshot.row_count, refreshedAt: snapshot.source_refreshed_at,
          message: stale ? 'Fuente desactualizada: se conserva la última copia. Revisar Sheets y el script.' : 'Solicitudes sincronizadas desde Sheets' });
      } catch {
        if (!cancelled) setStatus(old => ({ ...old, busy: false, message: 'No se pudo consultar la fuente. Se conservan los registros y decisiones locales.' }));
      } finally { inFlight = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [enabled, userId, hydrated, revision]);
  return { ...status, refresh };
}
