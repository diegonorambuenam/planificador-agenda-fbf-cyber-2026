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
      setInitialized(true);
      if (!nextSession) {
        setAuthorized(null);
        setStatus('loading');
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const email = session?.user.email;
    if (!supabase || !session || !email) return;
    const client = supabase;
    const memberEmail = email;
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;

    async function connect() {
      setStatus('loading');
      setMessage('Conectando con las capacidades compartidas…');
      const { data: member, error: memberError } = await client
        .from('team_members')
        .select('email')
        .eq('email', memberEmail.toLowerCase())
        .maybeSingle();
      if (!active) return;
      if (memberError || !member) {
        setAuthorized(false);
        setStatus('error');
        setMessage('Este correo no está autorizado para el equipo FBF.');
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

    void connect();
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [session, mergeCapacities, replaceCapacities]);

  const signIn = useCallback(async (email: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return { error: 'Supabase no está configurado.' };
    setMessage('Enviando enlace de acceso…');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) {
      setMessage(error.message);
      return { error: error.message };
    }
    setMessage('Revisa tu correo y abre el enlace para entrar.');
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseClient()?.auth.signOut();
    setSession(null);
    setAuthorized(null);
    setMessage('');
  }, []);

  const saveCapacities = useCallback(async (changes: CapacityChange[]) => {
    const localValues = Object.fromEntries(
      changes.map(({ warehouse, date, capacity }) => [capacityKey(warehouse, date), capacity]),
    );
    mergeCapacities(localValues);
    const supabase = getSupabaseClient();
    if (!supabase) return { error: null };
    if (!session || !authorized) return { error: 'Debes iniciar sesión con un correo autorizado.' };
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
    setStatus('synced');
    setMessage('Cambios guardados para todo el equipo');
    return { error: null };
  }, [authorized, mergeCapacities, session]);

  return {
    configured: isSupabaseConfigured,
    initialized,
    session,
    authorized,
    status,
    message,
    signIn,
    signOut,
    saveCapacities,
  };
}
