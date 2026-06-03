// Jay's Valet requests — Netlify Functions v2 CRUD over Netlify Blobs.
//   GET  /api/valet-requests?scope=mine   -> caller's requests
//   GET  /api/valet-requests?scope=queue  -> full queue (operators only)
//   POST /api/valet-requests {action:"create", data}
//   POST /api/valet-requests {action:"update", id, patch}
// All routes require a valid session cookie. Field-level rules below mirror
// what the old Firestore rules enforced (no client privilege escalation).
import {
  sessionFromRequest, listRequests, createRequest, updateRequest,
} from './_lib/valet-store.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// Whitelist what each role may write, so a customer can't reassign or advance.
const OPERATOR_FIELDS = ['status', 'stepIndex', 'operatorUid', 'operatorName'];
const CUSTOMER_FIELDS = ['tip', 'rating'];
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));

export default async (req) => {
  try {
    const sess = sessionFromRequest(req);
    if (!sess) return json(401, { error: 'not signed in' });

    if (req.method === 'GET') {
      const scope = new URL(req.url).searchParams.get('scope') || 'mine';
      const all = await listRequests();
      if (scope === 'queue') {
        if (sess.role !== 'operator') return json(403, { error: 'operators only' });
        return json(200, { requests: all });
      }
      return json(200, { requests: all.filter((r) => r.customerUid === sess.uid) });
    }

    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    let p; try { p = await req.json(); } catch { return json(400, { error: 'invalid json' }); }

    if (p.action === 'create') {
      const doc = await createRequest({
        ...(p.data || {}),
        customerUid: sess.uid,          // force ownership to the caller
        status: 'requested', stepIndex: 0,
        operatorUid: null, operatorName: null, tip: null, rating: null,
      });
      return json(200, { request: doc });
    }

    if (p.action === 'update') {
      if (!p.id) return json(400, { error: 'missing id' });
      const all = await listRequests();
      const cur = all.find((r) => r.id === p.id);
      if (!cur) return json(404, { error: 'not found' });

      let patch;
      if (sess.role === 'operator') {
        patch = pick(p.patch, OPERATOR_FIELDS);
      } else {
        if (cur.customerUid !== sess.uid) return json(403, { error: 'not your request' });
        patch = pick(p.patch, CUSTOMER_FIELDS);
      }
      return json(200, { request: await updateRequest(p.id, patch) });
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('valet-requests failed', err);
    return json(500, { error: 'server error' });
  }
};
