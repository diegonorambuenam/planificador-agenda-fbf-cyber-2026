'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { WarehouseId } from '@/src/types/planning';
import { capacityKey, usePlanningStore } from '@/src/store/planning-store';
import { CAPACITY_EVENT_ID, getSupabaseClient, isSupabaseConfigured } from '@/src/services/supabase';

export interface CapacityChange {
  warehouse: WarehouseId;
  date: string;
  capacity: number;
}

type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error';

export function useSharedCapacities() {
  const [session, setSession] = useState<Session | null>(null);
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
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitialized(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthorized(null);
      setAccount(null);
      setInitialized(true);
      if (!nextSession) {
        setAccount(null);
        setAuthorized(null);
        setStatus('loading');
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !session || !hydrated) return;
    const client = supabase;
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;

    async function connect() {
      setStatus('loading');
      setAuthorized(null);
      setMessage('Conectando con las capacidades compartidas…');
      const { data: member, error: memberError } = await client.rpc('fbf_access_status');
      if (!active) return;
      setAccount(memberError ? null : member);
      if (memberError || !member?.authorized) {
        setAuthorized(false);
        setStatus('error');
        setMessage(memberError ? 'No fue posible validar el acceso. Intenta iniciar sesión nuevamente.' : member?.pending ? '' : 'Sesión sin acceso. Ingresa nuevamente o solicita un código vigente al administrador.');
        return;
      }

      setAuthorized(true);
      const { data: rows, error } = await client
        .from('capacities')
        .select('warehouse,date,capacity')
        .eq('event_id', CAPACITY_EVENT_ID);
      if (!active) return;
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
            if (!active) return;
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
      if (!active) return;
      setAuthorized(false);
      setAccount(null);
      setStatus('error');
      setMessage('No fue posible conectar con Supabase. Vuelve a ingresar para reintentar.');
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
