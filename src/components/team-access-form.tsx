'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function TeamAccessForm({ pending, message, signIn, activate }: {
  pending: boolean;
  message: string;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  activate: (password: string) => Promise<{ error: string | null }>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="mt-6 space-y-4 text-left" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (pending && (password.length < 12 || new TextEncoder().encode(password).length > 72 || password !== confirmation)) {
      setError('Usa al menos 12 caracteres (máximo 72 bytes) y repite la misma contraseña.'); return;
    }
    setBusy(true);
    try {
      const result = pending ? await activate(password) : await signIn(username, password);
      if (result.error) setError(result.error);
    } catch { setError('No fue posible conectar. Intenta nuevamente.'); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); }
  }}>
    {!pending && <label className="field-label">Usuario<Input className="mt-1" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required disabled={busy} autoCapitalize="none" spellCheck={false} /></label>}
    <label className="field-label">{pending ? 'Crea tu contraseña' : 'Contraseña o código de activación'}<Input className="mt-1" type="password" autoComplete={pending ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label>
    {pending && <><label className="field-label">Repite tu contraseña<Input className="mt-1" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={busy} /></label><p className="text-xs leading-5 text-[#65756c]">Al menos 12 caracteres. Después de crearla, solo el administrador podrá restablecer el acceso desde Supabase.</p></>}
    <Button className="w-full bg-[#2d6b4c] text-white" type="submit" disabled={busy}>{busy ? 'Procesando…' : pending ? 'Crear contraseña' : 'Ingresar'}</Button>
    {(error || message) && <p role="status" aria-live="polite" className="rounded-xl bg-[#eef5f0] p-3 text-sm text-[#356149]">{error || message}</p>}
  </form>;
}
