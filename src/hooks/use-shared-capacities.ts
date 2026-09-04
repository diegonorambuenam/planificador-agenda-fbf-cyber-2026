'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { WarehouseId } from '@/src/types/planning';
import { capacityKey, usePlanningStore } from '@/src/store/planning-store';
import { CAPACITY_EVENT_ID, getSupabaseClient, isSupabaseConfigured } from '@/src/services/supabase';
import { sessionIdentity } from '@/src/services/session-identity';

export interface CapacityChange {
  warehouse: WarehouseId;
  date: string;
  capacity: number;
}

type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error';

export function useSharedCapacities() {
  const [session, setSession] = useState<Session | null>(null);
  const currentIdentity = useRef<string | null>(null);
  const verifiedIdentity = useRef<string | null>(null);
  const [initialized, setInitialized] = useState(!isSupabaseConfigured);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [account, setAccount] = useState<{ username?: string; pending: boolean; authorized: boolean } | null>(null);
  const hydrated = usePlanningStore((state) => state.hydrated);
  const [status, setStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'loading' : 'local');
  const [message, setMessage] = useState('');
  const replaceCapacities = usePlanningStore((state) => state.replaceCapacities);
  const mergeCapacities = usePlanningStore((state) => state.mergeCapacities);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    let receivedAuthEvent = false;
    const acceptSession = (nextSession: Session | null) => {
      if (!active) return;
      const identity = sessionIdentity(nextSession);
      if (identity !== currentIdentity.current || !nextSession) {
        currentIdentity.current = identity;
        verifiedIdentity.current = null;
        setAuthorized(null);
        setAccount(null);
        setStatus('loading');
      }
      setSession(nextSession);
      setInitialized(true);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      receivedAuthEvent = true;
      acceptSession(nextSession);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!receivedAuthEvent) acceptSession(data.session);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !session || !hydrated) return;
    const client = supabase;
    const identity = sessionIdentity(session);
    const background = verifiedIdentity.current === identity;
    let active = true;
    const isCurrent = () => active && currentIdentity.current === identity;
    let channel: ReturnType<typeof client.channel> | null = null;

    async function connect() {
      if (!background) {
        setStatus('loading');
        setAuthorized(null);
        setMessage('Conectando con las capacidades compartidas…');
      }
      const { data: member, error: memberError, status: responseStatus } = await client.rpc('fbf_access_status');
      if (!isCurrent()) return;
      if (memberError && background && responseStatus !== 401 && responseStatus !== 403) {
        setStatus('error');
        setMessage('No se pudo comprobar la conexión. Tu pantalla se conserva; vuelve a intentar cuando haya conexión.');
        return;
      }
      setAccount(memberError ? null : member);
      if (memberError || !member?.authorized) {
        verifiedIdentity.current = null;
        setAuthorized(false);
        setStatus('error');
        setMessage(memberError ? 'No fue posible validar el acceso. Intenta iniciar sesión nuevamente.' : member?.pending ? '' : 'Sesión sin acceso. Ingresa nuevamente o solicita un código vigente al administrador.');
        return;
      }

      verifiedIdentity.current = identity;
      setAuthorized(true);
      const { data: rows, error } = await client
        .from('capacities')
        .select('warehouse,date,capacity')
        .eq('event_id', CAPACITY_EVENT_ID);
      if (!isCurrent()) return;
      if (error) {
        setStatus('error');
        setMessage(`No fue posible descargar las capacidades: ${error.message}`);
        return;
      }
      const shared = Object.fromEntries(
        (rows ?? []).map((row) => [capacityKey(row.warehouse as WarehouseId, row.date), Number(row.capacity)]),
      );
      replaceCapacities(shared);
      setStatus('synced');
      setMessage('Capacidades sincronizadas');

      channel = client
        .channel(`capacities-${CAPACITY_EVENT_ID}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'capacities', filter: `event_id=eq.${CAPACITY_EVENT_ID}` },
          (payload) => {
            if (!isCurrent()) return;
            const row = payload.new as { warehouse?: WarehouseId; date?: string; capacity?: number };
            if (row.warehouse && row.date && row.capacity != null) {
              mergeCapacities({ [capacityKey(row.warehouse, row.date)]: Number(row.capacity) });
              setStatus('synced');
              setMessage('Capacidades sincronizadas');
            }
          },
        )
        .subscribe();
    }

    void connect().catch(() => {
      if (!isCurrent()) return;
      if (!background) {
        verifiedIdentity.current = null;
        setAuthorized(false);
        setAccount(null);
      }
      setStatus('error');
      setMessage(background ? 'Conexión interrumpida. Tu pantalla se conserva; comprueba tu conexión.' : 'No fue posible conectar con Supabase. Vuelve a ingresar para reintentar.');
    });
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [session, hydrated, mergeCapacities, replaceCapacities]);

  const signIn = useCallback(async (username: string, password: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase no está configurado.' };
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(normalized)) return { error: 'Revisa tu usuario y contraseña o código.' };
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({
      email: `${normalized}@fbf.invalid`, password,
    });
    if (error) {
      return { error: 'No pudimos ingresar. Revisa tu usuario y contraseña o código de activación.' };
    }
    return { error: null };
  }, []);

  const activate = useCallback(async (password: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase no está configurado.' };
    const { error } = await supabase.rpc('fbf_activate_account', { new_password: password });
    if (error) return { error: 'No se pudo activar. Usa una contraseña distinta del código; si persiste, solicita un nuevo código al administrador.' };
    // Never reuse the activation session: RLS deliberately rejects it.
    await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
    setAccount(null);
    setAuthorized(null);
    setMessage('Contraseña creada. Ingresa con tu usuario y tu nueva contraseña.');
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseClient()?.auth.signOut();
    setSession(null);
    setAuthorized(null);
    setAccount(null);
    setMessage('');
  }, []);

  const saveCapacities = useCallback(async (changes: CapacityChange[]) => {
    const localValues = Object.fromEntries(
      changes.map(({ warehouse, date, capacity }) => [capacityKey(warehouse, date), capacity]),
    );
    const supabase = getSupabaseClient();
    if (!supabase) { mergeCapacities(localValues); return { error: null }; }
    if (!session || !authorized) return { error: 'Debes iniciar sesión con un usuario autorizado.' };
    setStatus('saving');
    setMessage('Guardando cambios…');
    const { error } = await supabase.from('capacities').upsert(
      changes.map(({ warehouse, date, capacity }) => ({
        event_id: CAPACITY_EVENT_ID,
        warehouse,
        date,
        capacity,
      })),
      { onConflict: 'event_id,warehouse,date' },
    );
    if (error) {
      setStatus('error');
      setMessage(`No se guardó en Supabase: ${error.message}`);
      return { error: error.message };
    }
    mergeCapacities(localValues);
    setStatus('synced');
    setMessage('Cambios guardados para todo el equipo');
    return { error: null };
  }, [authorized, mergeCapacities, session]);

  return {
    configured: isSupabaseConfigured,
    initialized,
    session,
    authorized,
    account,
    activate,
    status,
    message,
    signIn,
    signOut,
    saveCapacities,
  };
}
