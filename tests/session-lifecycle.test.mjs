import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const identityUrl = url(compile('../src/services/session-identity.ts'));
const { sessionIdentity } = await import(identityUrl);
const session = (id = 'session-a', user = 'fixture-user', expires = 1) => ({
  user: { id: user }, access_token: 'header.' + Buffer.from(JSON.stringify({ session_id: id, exp: expires })).toString('base64url') + '.signature',
});

test('UI identity survives token refresh but not new sessions or users', () => {
  assert.equal(sessionIdentity(session()), sessionIdentity(session('session-a', 'fixture-user', 2)));
  assert.notEqual(sessionIdentity(session()), sessionIdentity(session('session-b')));
  assert.notEqual(sessionIdentity(session()), sessionIdentity(session('session-a', 'another-user')));
  assert.equal(sessionIdentity(null), null);
  assert.notEqual(sessionIdentity({ user: { id: 'u' }, access_token: 'opaque-a' }), sessionIdentity({ user: { id: 'u' }, access_token: 'opaque-b' }));
});

// Minimal hook scheduler: executes the actual hook with mocked React/Supabase,
// records each render (including intermediate access-screen states), no browser.
test('refocus and refresh preserve authorized renders; signout and revocation block access', async () => {
  const slots = [], effects = [], renders = [];
  let cursor = 0, dirty = false, result, listener, reply = { data: { authorized: true, pending: false }, error: null, status: 200 };
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !depsEqual(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !depsEqual(slots[i].deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const state = { hydrated: true, replaceCapacities() {}, mergeCapacities() {} };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: session() } }),
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { listener('SIGNED_OUT', null); },
    },
    rpc: async () => reply,
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
  };
  globalThis.__sessionHookFixture = { react, state, client };
  const mockUrl = url(`const f = globalThis.__sessionHookFixture;
    export const {useState,useRef,useEffect,useCallback}=f.react;
    export const usePlanningStore=selector=>selector(f.state);
    export const capacityKey=(warehouse,date)=>warehouse+date;
    export const CAPACITY_EVENT_ID='fixture', isSupabaseConfigured=true;
    export const getSupabaseClient=()=>f.client;`);
  const code = compile('../src/hooks/use-shared-capacities.ts')
    .replace(/(['"])(react|@\/src\/store\/planning-store|@\/src\/services\/supabase)\1/g, JSON.stringify(mockUrl))
    .replace(/(['"])@\/src\/services\/session-identity\1/g, JSON.stringify(identityUrl));
  const { useSharedCapacities } = await import(url(code));
  async function settle() {
    for (let i = 0; i < 12; i++) {
      if (dirty || !result) {
        dirty = false; cursor = 0; result = useSharedCapacities();
        renders.push({ authorized: result.authorized, user: result.session?.user.id });
        while (effects.length) effects.shift()();
      }
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  try {
    await settle(); assert.equal(result.authorized, true);
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
      renders.length = 0;
      listener(event, session('session-a', 'fixture-user', 2)); await settle();
      assert.ok(renders.length > 0);
      assert.ok(renders.every(r => r.authorized === true), `${event} must not unmount the planner`);
    }
    reply = { data: null, error: { message: 'offline' }, status: 0 };
    listener('SIGNED_IN', session()); await settle();
    assert.equal(result.authorized, true); assert.equal(result.status, 'error');
    reply = { data: { authorized: false, pending: false }, error: null, status: 200 };
    listener('SIGNED_IN', session()); await settle(); assert.equal(result.authorized, false);
    reply = { data: { authorized: true, pending: false }, error: null, status: 200 };
    renders.length = 0;
    listener('SIGNED_IN', session('session-b')); await settle();
    assert.ok(renders.some(r => r.authorized === null)); assert.equal(result.authorized, true);
    listener('SIGNED_OUT', null); await settle();
    assert.equal(result.session, null); assert.equal(result.authorized, null);
  } finally {
    slots.forEach(slot => slot?.cleanup?.());
    delete globalThis.__sessionHookFixture;
  }
});
