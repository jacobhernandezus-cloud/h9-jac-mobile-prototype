// Jay's Valet — data layer. One interface, two backends:
//   • NetlifyBackend — Netlify Functions + Netlify Blobs (no Google/AWS account).
//                      Auth via signed cookie; realtime via short-interval polling.
//   • DemoBackend    — in-memory + localStorage (cross-tab sync), no backend at all.
// app.js never talks to the network directly; it talks to the backend returned here.
// We auto-detect: if /api/valet-auth answers, we're live; otherwise (static file
// serving) we fall back to demo so the app is always runnable and shareable.

const API = "/api";
const POLL_MS = 3000;

const DEMO_USERS = {
  // The owner runs the FBO — oversight only, not a customer placing requests.
  owner: {
    uid: "demo-owner", role: "owner", name: "George Marsh", avatar: "GM",
    greet: "Good morning, George.", sub: "Every request across the ramp, in one place.",
  },
  tenant: {
    uid: "demo-tenant", role: "tenant", name: "Alex Rivera", avatar: "AR",
    greet: "Welcome, Alex.", sub: "Leasing Row C · Tie-down 4.",
    tail: "N218AT", aircraftType: "Cessna 182T", home: "Row C · TD 4",
  },
  lineman: {
    uid: "demo-operator", role: "lineman", name: "Marcus Reyes", avatar: "MR",
  },
};

/* ============================ DEMO BACKEND ============================ */
class DemoBackend {
  constructor() {
    this.mode = "demo";
    this.KEY = "valet_demo_requests";
    this.role = sessionStorage.getItem("valet_demo_role") || "tenant";
    this.watchers = new Set();
    this._seedIfEmpty();
    window.addEventListener("storage", (e) => {
      if (e.key === this.KEY) this._notify();
    });
  }
  // Pre-populate the queue so the operator view is never blank in a fresh demo.
  // These belong to other customers, so they show in the operator queue but not
  // in the owner/tenant "my requests" list.
  _seedIfEmpty() {
    if (this._all().length) return;
    const now = Date.now();
    const seed = [
      {
        id: "seed-park-1", type: "park",
        customerUid: "seed-okafor", customerName: "Daniel Okafor", customerRole: "tenant",
        tail: "N740JC", aircraftType: "Pilatus PC-12", home: "Row A · 3", slot: null,
        cars: "0", fuel: "Top off Jet A", services: [],
        spot: "Row A · 3", status: "inprogress", stepIndex: 2,
        operatorUid: "demo-operator", operatorName: "Marcus Reyes",
        tip: { amount: 20, mock: true }, rating: null,
        steps: [
          ["Request received", "Lineman notified"],
          ["Lineman assigned", "On the way to your aircraft"],
          ["Marshalling", "Guiding you to parking"],
          ["Fueling", "Top off Jet A"],
          ["Parked on ramp", "Secured at your spot"],
        ],
        createdAt: now - 9 * 60000, updatedAt: now - 2 * 60000,
      },
      {
        id: "seed-park-2", type: "park",
        customerUid: "seed-bradley", customerName: "Tom Bradley", customerRole: "tenant",
        tail: "N88QX", aircraftType: "Beechcraft King Air 350", home: "Row C · TD 7", slot: null,
        cars: "0", fuel: "None", services: ["Lav service"],
        spot: "Row C · TD 7", status: "inprogress", stepIndex: 1,
        operatorUid: "demo-operator", operatorName: "Marcus Reyes",
        tip: null, rating: null,
        steps: [
          ["Request received", "Lineman notified"],
          ["Lineman assigned", "On the way to your aircraft"],
          ["Marshalling", "Guiding you to parking"],
          ["Services", "Lav service before parking"],
          ["Parked on ramp", "Secured at your spot"],
        ],
        createdAt: now - 5 * 60000, updatedAt: now - 4 * 60000,
      },
      {
        id: "seed-stage-1", type: "stage",
        customerUid: "seed-anand", customerName: "Priya Anand", customerRole: "tenant",
        tail: "N512RG", aircraftType: "Cessna Citation CJ3", home: "Row A · Spot 7",
        slot: "2:30 PM", cars: "1", fuel: "Top off Jet A", services: ["Catering"],
        spot: "Row A · Spot 7", status: "requested", stepIndex: 0,
        operatorUid: null, operatorName: null,
        tip: { amount: 40, mock: true }, rating: null,
        steps: [
          ["Request received", "Lineman notified"],
          ["Lineman assigned", "Your lineman is on the way"],
          ["Staging on ramp", "Positioning your aircraft"],
          ["Cars valeted", "1 vehicle parked in the staging area"],
          ["Fueling", "Top off Jet A"],
          ["Staged & ready", "Ready for departure at Row A · Spot 7"],
        ],
        createdAt: now - 1 * 60000, updatedAt: now - 1 * 60000,
      },
    ];
    localStorage.setItem(this.KEY, JSON.stringify(seed));
  }
  _all() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); }
    catch { return []; }
  }
  _save(list) {
    localStorage.setItem(this.KEY, JSON.stringify(list));
    this._notify(); // same-tab (storage event only fires in OTHER tabs)
  }
  _notify() { this.watchers.forEach((w) => w(this._all())); }

  onAuth(cb) { this._authCb = cb; cb(this.session()); return () => {}; }
  session() { return { ...DEMO_USERS[this.role] }; }
  demoSwitch(role) {
    this.role = role;
    sessionStorage.setItem("valet_demo_role", role);
    if (this._authCb) this._authCb(this.session());
  }
  async signIn() { throw new Error("Demo mode — use the role switcher above."); }
  async signUp() { this.demoSwitch("tenant"); }
  async signOut() {}
  async registerPush() {} // no-op in demo (in-app banners only)

  async createRequest(data) {
    const list = this._all();
    const id = "r" + Date.now() + Math.floor(Math.random() * 999);
    list.unshift({ id, ...data, createdAt: Date.now(), updatedAt: Date.now() });
    this._save(list);
    return id;
  }
  async updateRequest(id, patch) {
    const list = this._all();
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    this._save(list);
  }
  async setTipRating(id, patch) { return this.updateRequest(id, patch); }

  watchMyRequests(uid, cb) {
    const w = (all) => cb(all.filter((r) => r.customerUid === uid));
    this.watchers.add(w); w(this._all());
    return () => this.watchers.delete(w);
  }
  watchQueue(cb) {
    const w = (all) => cb(all);
    this.watchers.add(w); w(this._all());
    return () => this.watchers.delete(w);
  }
}

/* =========================== NETLIFY BACKEND ========================== */
// Talks to /api/valet-auth and /api/valet-requests. No Firebase, no external
// SDK — just fetch() with the session cookie. Realtime is short-interval
// polling, which is plenty for this volume and keeps everything same-origin
// (works under the site's strict `connect-src 'self'` CSP).
class NetlifyBackend {
  constructor(initialUser) {
    this.mode = "live";
    this.user = initialUser || null;
  }
  async _post(path, body) {
    const res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "request-failed");
    return data;
  }
  async _get(path) {
    const res = await fetch(`${API}/${path}`, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "request-failed");
    return data;
  }

  onAuth(cb) { this._authCb = cb; cb(this.user); return () => {}; }
  demoSwitch() {} // n/a in live mode

  async signIn(email, password) {
    const { user } = await this._post("valet-auth", { action: "login", email, password });
    this.user = user;
    if (this._authCb) this._authCb(user);
  }
  async signUp({ name, email, password, tail, type, lease }) {
    const { user } = await this._post("valet-auth", { action: "signup", name, email, password, tail, type, lease });
    this.user = user;
    if (this._authCb) this._authCb(user);
  }
  async signOut() {
    await this._post("valet-auth", { action: "logout" }).catch(() => {});
    this.user = null;
    if (this._authCb) this._authCb(null);
  }
  async registerPush() {} // in-app banners only — nothing to register

  async createRequest(data) {
    const { request } = await this._post("valet-requests", { action: "create", data });
    return request.id;
  }
  async updateRequest(id, patch) {
    // `notify` is a client-only hint for the old push path; never sent to the server.
    const { notify, ...clean } = patch;
    await this._post("valet-requests", { action: "update", id, patch: clean });
  }
  async setTipRating(id, patch) {
    await this._post("valet-requests", { action: "update", id, patch });
  }

  _poll(scope, cb) {
    let stopped = false, timer = null;
    const tick = async () => {
      if (stopped) return;
      try { const { requests } = await this._get(`valet-requests?scope=${scope}`); if (!stopped) cb(requests || []); }
      catch (_) { /* transient — try again next tick */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }
  watchMyRequests(_uid, cb) { return this._poll("mine", cb); }
  watchQueue(cb) { return this._poll("queue", cb); }
}

/* ============================ backend select ========================== */
// `?demo=1` forces the self-serve demo experience (role switcher, no login)
// even on the deployed site — this is the shareable link for stakeholders.
// It's sticky for the session so SPA reloads keep demo mode.
function forceDemo() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get("demo") === "1") { localStorage.setItem("valet_force_demo", "1"); return true; }
    return localStorage.getItem("valet_force_demo") === "1";
  } catch (_) { return false; }
}

// Probe the auth function. If it responds we're deployed on Netlify (live);
// if it 404s / errors (plain static file server) we fall back to demo.
export async function getBackend() {
  if (forceDemo()) return new DemoBackend();
  try {
    const res = await fetch(`${API}/valet-auth`, { credentials: "same-origin" });
    if (res.ok) {
      const { user } = await res.json();
      return new NetlifyBackend(user);
    }
  } catch (_) { /* no functions available — demo it is */ }
  return new DemoBackend();
}

export { DEMO_USERS };
