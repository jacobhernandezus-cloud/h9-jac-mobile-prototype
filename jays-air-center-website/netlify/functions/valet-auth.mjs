// Jay's Valet auth — Netlify Functions v2, no third-party identity provider.
//   GET  /api/valet-auth          -> { user } current session (or null)
//   POST /api/valet-auth {action} -> login | signup | logout
// Sessions are signed HttpOnly cookies; passwords scrypt-hashed in Netlify Blobs.
import {
  ensureSeed, getUserByEmail, getUser, createUser, verifyPassword, publicUser,
  setCookie, clearCookie, sessionFromRequest, signSession, corsHeaders, preflight,
} from './_lib/valet-store.mjs';

export default async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const cors = corsHeaders(req);
  const json = (status, body, cookie) => {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors };
    if (cookie) headers['set-cookie'] = cookie;
    return new Response(JSON.stringify(body), { status, headers });
  };
  try {
    await ensureSeed();

    if (req.method === 'GET') {
      const sess = sessionFromRequest(req);
      if (!sess) return json(200, { user: null });
      return json(200, { user: publicUser(await getUser(sess.uid)) });
    }

    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    let p; try { p = await req.json(); } catch { return json(400, { error: 'invalid json' }); }

    if (p.action === 'logout') return json(200, { ok: true }, clearCookie());

    if (p.action === 'login') {
      const u = await getUserByEmail(p.email || '');
      if (!u || !verifyPassword(p.password || '', u.pass)) return json(401, { error: 'invalid-credential' });
      // token mirrors the cookie session — used by the native app as a bearer
      return json(200, { user: publicUser(u), token: signSession(u) }, setCookie(u));
    }

    if (p.action === 'signup') {
      if (!p.email || !p.password) return json(400, { error: 'missing email or password' });
      if (String(p.password).length < 8) return json(400, { error: 'weak-password' });
      try {
        const u = await createUser({
          name: p.name || 'New Tenant', email: p.email, password: p.password, role: 'tenant',
          tail: p.tail || null, aircraftType: p.type || null,
          home: (p.lease || '').replace('Tie-down — ', '') || null,
        });
        return json(200, { user: publicUser(u), token: signSession(u) }, setCookie(u));
      } catch (e) {
        if (e.code === 'email-already-in-use') return json(409, { error: 'email-already-in-use' });
        throw e;
      }
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('valet-auth failed', err);
    return json(500, { error: 'server error' });
  }
};
