import type { Session } from '@supabase/supabase-js';

// UI lifecycle identity only. Authorization remains enforced by Supabase RPC/RLS.
export function sessionIdentity(session: Session | null): string | null {
  if (!session) return null;
  try {
    const payload = session.access_token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (typeof claims.session_id === 'string' && claims.session_id) {
      return JSON.stringify([session.user.id, claims.session_id]);
    }
  } catch { /* Unknown token formats must not preserve a different session. */ }
  return JSON.stringify([session.user.id, session.access_token]);
}
