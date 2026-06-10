// Jay's Valet — main app. Talks to the backend abstraction (live Netlify or
// demo), renders the member + operator experiences, and drives the live status
// loop: customer requests -> operator queue -> operator advances -> customer
// sees it update in real time and gets an in-app banner.
import { getBackend, DEMO_USERS } from "./data.js";

let backend, session = null;
let unsubAuth, unsubData;
let myRequests = [];          // member: my requests
let queue = [];               // operator: full queue
let trackingId = null;        // request currently open in the track view
let screen = "loading";
const lastStep = {};          // requestId -> stepIndex, for change notifications
let booted = false;

const $ = (id) => document.getElementById(id);
const root = $("root");

/* ------------------------------- flows -------------------------------- */
// Two member flows: park (aircraft is on the ground — request parking now) and
// stage (schedule a departure). Both optionally collect fuel, services and a
// tip, and end with one Submit button.
const FLOWS = {
  park: {
    title: "Request plane parking",
    sub: "Your aircraft is on the ground at KSNA.",
    showFuel: true, showServices: true, showTip: true,
    cta: "Submit parking request",
    trackTitle: "Lineman meeting your aircraft", finalKind: "arrival",
    completeTitle: "Parked on the ramp", completeSpotLabel: "Parked at", spot: null,
    buildSteps(o) {
      const s = [
        ["Request received", "Lineman notified"],
        ["Lineman assigned", "On the way to your aircraft"],
        ["Marshalling", "Guiding you to parking"],
      ];
      if (o.fuel && o.fuel !== "None") s.push(["Fueling", o.fuel]);
      if (o.services && o.services.length) s.push(["Services", o.services.join(" · ") + " before parking"]);
      s.push(["Parked on ramp", "Secured at your spot"]);
      return s;
    },
  },
  stage: {
    title: "Request ramp staging",
    sub: "Schedule a departure — we'll have your aircraft ready on the ramp.",
    slotKind: "depart", timeLabel: "Scheduled departure",
    timeNote: "Scheduled departures only. Earliest available is 2 hours out — this keeps last-minute ramp traffic down.",
    showCars: true, showFuel: true, showServices: true, showTip: true, cta: "Submit staging request",
    trackTitle: "Estimated ready", finalKind: "departure",
    completeTitle: "Staged & ready", completeSpotLabel: "Staged at", spot: "Row A · Spot 7",
    buildSteps(o) {
      const s = [
        ["Request received", "Lineman notified"],
        ["Lineman assigned", "Your lineman is on the way"],
        ["Staging on ramp", "Positioning your aircraft"],
      ];
      if (o.cars && o.cars !== "0")
        s.push(["Cars valeted", (o.cars === "1" ? "1 vehicle" : o.cars + " vehicles") + " parked in the staging area"]);
      if (o.fuel && o.fuel !== "None") s.push(["Fueling", o.fuel]);
      s.push(["Staged & ready", "Ready for departure at " + this.spot]);
      return s;
    },
  },
};

/* ------------------------------- boot --------------------------------- */
(async function boot() {
  backend = await getBackend();
  window.addEventListener("valet-push", (e) => {
    const n = e.detail?.notification || {};
    banner("✈", n.title || "Jay's Valet", n.body || "");
  });
  unsubAuth = backend.onAuth((u) => {
    session = u;
    booted = true;
    resubscribe();
    renderEnvbar();
    route();
  });
})();

function resubscribe() {
  if (unsubData) { unsubData(); unsubData = null; }
  if (!session) return;
  if (session.role === "lineman" || session.role === "owner") {
    unsubData = backend.watchQueue((list) => {
      queue = list;
      if (screen === "lineman") renderLineman();
      if (screen === "owner") renderOwner();
    });
  } else {
    backend.registerPush?.(session.uid);
    unsubData = backend.watchMyRequests(session.uid, (list) => {
      list.forEach((r) => {
        if (lastStep[r.id] === undefined) { lastStep[r.id] = r.stepIndex ?? 0; return; }
        if ((r.stepIndex ?? 0) > lastStep[r.id]) {
          const step = (r.steps || [])[r.stepIndex] || [r.statusLabel || "Update", ""];
          banner(stepIcon(step[0]), step[0], step[1]);
          lastStep[r.id] = r.stepIndex;
        }
      });
      myRequests = list;
      if (screen === "track" && trackingId) renderTrack();
      if (screen === "home") renderHome();
    });
  }
}

/* ------------------------------ router -------------------------------- */
function route() {
  if (!booted) return;
  if (!session) return renderAuth();
  if (session.role === "lineman") return renderLineman();
  if (session.role === "owner") return renderOwner();
  renderHome();
}
function go(s) { screen = s; }

/* ------------------------------ env bar ------------------------------- */
function renderEnvbar() {
  const bar = $("envbar");
  if (backend.mode === "demo") {
    bar.classList.remove("live");
    bar.innerHTML = `
      <span class="dot"></span> DEMO
      <select id="roleSel" title="Switch persona">
        <option value="tenant" ${session?.role === "tenant" ? "selected" : ""}>Tenant</option>
        <option value="lineman" ${session?.role === "lineman" ? "selected" : ""}>Lineman</option>
        <option value="owner" ${session?.role === "owner" ? "selected" : ""}>Owner</option>
      </select>`;
    $("roleSel").onchange = (e) => { trackingId = null; backend.demoSwitch(e.target.value); };
  } else {
    bar.classList.add("live");
    bar.innerHTML = `<span class="dot"></span> LIVE · ${session ? session.name + " · " + session.role : "signed out"}
      ${session ? '<button id="soBtn" style="background:none;border:none;color:#9fb0c2;margin-left:8px;cursor:pointer;font-size:10.5px;text-decoration:underline">Sign out</button>' : ""}`;
    if (session) $("soBtn").onclick = () => backend.signOut();
  }
}

/* ------------------------------- auth --------------------------------- */
let authMode = "login";
function renderAuth() {
  go("auth");
  if (authMode === "signup") return renderSignup();
  root.innerHTML = `
    <div class="auth">
      <div class="logo">JAY'S <b>VALET</b></div>
      <h1>Welcome back</h1>
      <p class="tag">Request parking for your aircraft the moment you're on the ground — and track every step.</p>
      <div class="field"><label>Email</label><input id="liEmail" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Password</label><input id="liPass" type="password" placeholder="••••••••"></div>
      <div class="err" id="liErr"></div>
      <button class="primary" style="margin-top:18px" id="liBtn">Sign in</button>
      <div class="switchrow">New tenant? <button class="linkbtn" id="toSignup">Create an account</button></div>
    </div>`;
  $("liBtn").onclick = async () => {
    try {
      await backend.signIn($("liEmail").value.trim(), $("liPass").value);
    } catch (e) { $("liErr").textContent = friendlyAuthErr(e); }
  };
  $("toSignup").onclick = () => { authMode = "signup"; renderAuth(); };
}
function renderSignup() {
  root.innerHTML = `
    <div class="auth" style="padding-top:24px">
      <div class="logo">JAY'S <b>VALET</b></div>
      <h1 style="margin-top:12px">Become a tenant</h1>
      <p class="tag">Lease a ramp tie-down at Jay's and use the valet service.</p>
      <div class="field"><label>Full name</label><input id="suName" placeholder="Alex Rivera"></div>
      <div class="field"><label>Email</label><input id="suEmail" type="email" placeholder="alex@example.com"></div>
      <div class="field"><label>Password</label><input id="suPass" type="password" placeholder="Choose a password"></div>
      <div class="field"><label>Aircraft tail number</label><input id="suTail" placeholder="N218AT" style="font-family:'JetBrains Mono',monospace;letter-spacing:.06em"></div>
      <div class="field"><label>Aircraft type</label><input id="suType" placeholder="Cessna 182T"></div>
      <div class="field"><label>Lease</label><select id="suLease"><option>Tie-down — Row C · TD 4</option><option>Ramp parking (monthly)</option></select></div>
      <div class="agree"><input type="checkbox" id="suAgree" checked><span>I agree to Jay's Air Center tenant terms and authorize per-use billing for valet services.</span></div>
      <div class="err" id="suErr"></div>
      <button class="primary" style="margin-top:16px" id="suBtn">Create tenant account</button>
      <div class="switchrow">Already have an account? <button class="linkbtn" id="toLogin">Sign in</button></div>
    </div>`;
  $("toLogin").onclick = () => { authMode = "login"; renderAuth(); };
  $("suBtn").onclick = async () => {
    if (!$("suAgree").checked) { $("suErr").textContent = "Please accept the tenant terms."; return; }
    try {
      await backend.signUp({
        name: $("suName").value.trim() || "Alex Rivera",
        email: $("suEmail").value.trim(), password: $("suPass").value || "valet123",
        tail: $("suTail").value.trim() || "N218AT", type: $("suType").value.trim() || "Cessna 182T",
        lease: $("suLease").value,
      });
      banner("✓", "Account created", "Welcome to Jay's Valet!");
    } catch (e) { $("suErr").textContent = friendlyAuthErr(e); }
  };
}

/* ------------------------------- home --------------------------------- */
function memberProfile() {
  if (backend.mode === "demo") return DEMO_USERS[session.role];
  return {
    ...session,
    greet: "Welcome, " + (session.name || "").split(" ")[0] + ".",
    sub: session.role === "tenant" ? "Tenant account." : "Your aircraft is ready when you are.",
    tail: session.tail || (myRequests[0]?.tail) || "—",
    aircraftType: session.aircraftType || (myRequests[0]?.aircraftType) || "",
    home: session.home || (myRequests[0]?.home) || "—",
    billNote: session.role === "tenant" ? "Valet services are billed per use to your tenant account." : null,
  };
}
function renderHome() {
  go("home");
  const m = memberProfile();
  const active = myRequests.find((r) => r.status === "requested" || r.status === "inprogress");
  const activeStatus = active ? ((active.steps || [])[active.stepIndex ?? 0]?.[0] || active.statusLabel || "In progress") : null;
  const recent = myRequests.filter((r) => r.status === "complete").slice(0, 2);

  root.innerHTML = `
    <div class="ahead">
      <div class="brand">JAY'S <b>VALET</b></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="role-tag">${m.role}</span><div class="avatar">${m.avatar || "?"}</div>
      </div>
    </div>
    <div class="h-title">${m.greet}</div>
    <div class="h-sub">${m.sub}</div>

    <div class="ac-card${active ? " tappable" : ""}" id="acCard"${active ? ' role="button" tabindex="0"' : ""}>
      <div class="plane">✈</div>
      <span class="badge ${active ? "inprog" : "parked"}">● ${active ? "In progress" : "On the ramp"}</span>
      <div class="ac-tail" style="margin-top:12px">${m.tail}</div>
      <div class="ac-type">${m.aircraftType || ""}</div>
      <div class="ac-meta">
        <div><span>Location</span><b>${m.home}</b></div>
        ${active ? `<div><span>Live status</span><b>${activeStatus} ›</b></div>` : ""}
      </div>
    </div>

    <div class="home-cta">
      <button class="primary big" data-flow="park">✈&nbsp; Request parking</button>
      <button class="ghost" data-flow="stage">🗓️&nbsp; Request staging</button>
    </div>
    ${m.billNote ? `<div class="note">${m.billNote}</div>` : ""}

    ${recent.length ? `<div class="section-label">Recent activity</div>
      ${recent.map((r) => `<div class="act" data-open="${r.id}" style="cursor:pointer"><div class="dot">${stepIcon(FLOWS[r.type]?.completeTitle || "")}</div>
        <div class="t"><b>${FLOWS[r.type]?.completeTitle || "Completed"}</b>
        <span>${r.spot || r.home || ""} · ${r.operatorName || "Jay's line"}${r.tip ? " · tipped $" + r.tip.amount : ""}</span></div>
        <div class="when">${fmtDate(r.updatedAt)}</div></div>`).join("")}` : ""}

    <div class="tabbar">
      <button class="active"><span class="ti">⌂</span>Home</button>
      <button id="actTab"><span class="ti">≣</span>Activity</button>
    </div>`;

  root.querySelectorAll("[data-flow]").forEach((b) => b.onclick = () => openFlow(b.dataset.flow));
  const openActive = () => { trackingId = active.id; renderTrack(); };
  const acCard = $("acCard"); if (acCard && active) {
    acCard.onclick = openActive;
    acCard.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openActive(); } };
  }
  root.querySelectorAll("[data-open]").forEach((el) => el.onclick = () => { trackingId = el.dataset.open; renderTrack(); });
  $("actTab").onclick = renderActivity;
}

/* ----------------------------- request -------------------------------- */
let draft = {};
function openFlow(key) {
  const f = FLOWS[key]; const m = memberProfile();
  draft = { type: key, cars: "0", services: [], fuel: "None", slot: null, tip: null };
  let h = `<div class="back" id="backBtn">‹ Back</div>
    <div class="h-title">${f.title}</div>
    <div class="h-sub">${m.tail} · ${m.aircraftType || ""} · ${f.sub}</div>`;

  if (f.slotKind) {
    const slots = genSlots(f.slotKind);
    draft.slot = slots[0];
    h += `<div class="section-label">${f.timeLabel}</div><div class="chips" id="slotChips">` +
      slots.map((s, i) => `<div class="chip ${i === 0 ? "sel" : ""}" data-slot="${s}">${s}</div>`).join("") +
      `</div><div class="note">${f.timeNote}</div>`;
  }
  if (f.showCars) {
    h += `<div class="section-label">Cars to valet — parking in the staging area</div><div class="chips" id="carChips">` +
      ["0", "1", "2", "3", "4+"].map((c) => `<div class="chip ${c === "0" ? "sel" : ""}" data-car="${c}">${c}</div>`).join("") +
      `</div><div class="note">Lets the valet know how many vehicles to park while you're out.</div>`;
  }
  if (f.showFuel) {
    h += `<div class="section-label">Fuel</div><div class="chips" id="fuelChips">` +
      ["None", "Top off Jet A", "Top off 100LL"].map((c) => `<div class="chip ${c === "None" ? "sel" : ""}" data-fuel="${c}">${c}</div>`).join("") +
      `</div>`;
  }
  if (f.showServices) {
    h += `<div class="section-label">Additional services</div><div class="chips" id="svcChips">` +
      ["Lav service", "Potable water", "Ground power", "Rental car", "Catering"].map((s) => `<div class="chip" data-svc="${s}">${s}</div>`).join("") +
      `</div>`;
  }
  if (f.showTip) {
    const tips = [["10", "$10"], ["20", "$20"], ["40", "$40"], ["custom", "Custom"]];
    h += `<div class="section-label">Add a tip — optional</div>
      <div class="tip-grid" id="tipGrid">` +
      tips.map(([v, l]) => `<div class="tip-amt" data-tip="${v}">${l}</div>`).join("") +
      `</div>`;
  }

  h += `<div class="submitbar">${f.showTip ? `<div class="note">100% of tips go to your lineman. Recorded only — no card is charged in this demo.</div>` : ""}<button class="primary" id="submitBtn">${f.cta}</button></div>`;
  root.innerHTML = h; go("request");

  $("backBtn").onclick = renderHome;
  bindOne("slotChips", "slot", (v) => draft.slot = v);
  bindOne("carChips", "car", (v) => draft.cars = v);
  bindOne("fuelChips", "fuel", (v) => draft.fuel = v);
  bindMulti("svcChips", "svc", () => {
    draft.services = [...root.querySelectorAll('#svcChips .chip.sel')].map((c) => c.dataset.svc);
  });
  bindTip();
  makeTogglesAccessible(root);
  $("submitBtn").onclick = submitFlow;
}
/* Form chips and tip tiles are divs — give them a keyboard path and announce
   selection state to assistive tech. */
function makeTogglesAccessible(scope) {
  scope.querySelectorAll(".chip,.tip-amt,.opt").forEach((el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", el.classList.contains("sel") ? "true" : "false");
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
    });
  });
  scope.addEventListener("click", (e) => {
    const t = e.target.closest(".chip,.tip-amt,.opt");
    if (!t) return;
    scope.querySelectorAll(".chip,.tip-amt,.opt").forEach((el) =>
      el.setAttribute("aria-pressed", el.classList.contains("sel") ? "true" : "false"));
  });
}
function bindOne(id, attr, set) {
  const wrap = $(id); if (!wrap) return;
  wrap.querySelectorAll(".chip").forEach((c) => c.onclick = () => {
    wrap.querySelectorAll(".chip").forEach((x) => x.classList.remove("sel"));
    c.classList.add("sel"); set(c.dataset[attr]);
  });
}
function bindMulti(id, attr, set) {
  const wrap = $(id); if (!wrap) return;
  wrap.querySelectorAll(".chip").forEach((c) => c.onclick = () => { c.classList.toggle("sel"); set(); });
}
function bindTip() {
  const wrap = $("tipGrid"); if (!wrap) return;
  wrap.querySelectorAll(".tip-amt").forEach((el) => el.onclick = () => {
    if (el.classList.contains("sel")) { // tap again to opt out — no tip
      el.classList.remove("sel"); draft.tip = null; return;
    }
    const v = el.dataset.tip;
    let amt;
    if (v === "custom") {
      amt = parseInt(prompt("Tip amount ($)", "30") || "0", 10);
      if (!amt || amt < 1) amt = null;
    } else amt = parseInt(v, 10);
    draft.tip = amt;
    wrap.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
    if (amt) el.classList.add("sel");
  });
}

async function submitFlow() {
  const f = FLOWS[draft.type]; const m = memberProfile();
  const base = {
    type: draft.type, customerUid: session.uid, customerName: m.name, customerRole: m.role,
    tail: m.tail, aircraftType: m.aircraftType || "", home: m.home,
    slot: draft.slot, cars: draft.cars, fuel: draft.fuel, services: draft.services,
    spot: f.spot || m.home, status: "requested", stepIndex: 0,
    operatorUid: null, operatorName: null,
    tip: draft.tip ? { amount: draft.tip, mock: true } : null, rating: null,
  };
  base.steps = f.buildSteps(draft);
  const id = await backend.createRequest(base);
  trackingId = id;
  banner("✓", base.steps[0][0], base.steps[0][1]);
  renderTrack();
}

/* ------------------------------ tracking ------------------------------ */
function renderTrack() {
  go("track");
  const r = myRequests.find((x) => x.id === trackingId);
  if (!r) { // not yet in snapshot (just created) — show a spinner; watcher will re-render
    root.innerHTML = `<div class="back" id="backBtn">‹ Back</div><div class="spinner"></div>`;
    $("backBtn").onclick = renderHome; return;
  }
  const f = FLOWS[r.type]; const steps = r.steps || [];
  if (r.status === "complete") return renderReady(r);

  const idx = r.stepIndex || 0;
  root.innerHTML = `
    <div class="back" id="backBtn">‹ Back</div>
    <div class="ahead" style="padding-top:0"><div class="brand">JAY'S <b>VALET</b></div>
      <span class="badge inprog">● In progress</span></div>
    <div class="track-hero">
      <div class="small">${f.trackTitle}</div>
      <div class="big">${r.slot || "In progress"}</div>
      <div class="spot">${r.spot || r.home}</div>
    </div>
    <div class="steps">${steps.map((s, i) => {
      const cls = i < idx ? "done" : (i === idx ? "active" : "");
      const node = i < idx ? "✓" : (i + 1);
      return `<div class="step ${cls}"><div class="node">${node}</div><div class="rail"></div>
        <div class="lbl"><b>${s[0]}</b><span>${s[1]}</span></div></div>`;
    }).join("")}</div>
    ${r.operatorName
      ? `<div class="section-label">Assigned lineman</div>
         <div class="crew-row"><div class="pic">${initials(r.operatorName)}</div>
         <div class="info"><b>${r.operatorName}</b><span>Lineman · Jay's Air Center</span></div>
         <a class="call" href="tel:+19497555000">✆</a></div>`
      : `<div class="section-label">Assigned lineman</div>
         <div class="crew-row"><div class="pic">…</div>
         <div class="info"><b>Awaiting assignment</b><span>A lineman will be assigned shortly</span></div></div>`}
    ${r.tip
      ? `<div class="note" style="text-align:center">♥ $${r.tip.amount} tip added for ${r.operatorName || "your lineman"}.</div>`
      : (r.operatorName
        ? `<div class="section-label">Say thanks — tip your lineman</div>
           <div class="tip-grid" id="trackTip">${[["10", "$10"], ["20", "$20"], ["40", "$40"], ["custom", "Custom"]].map(([v, l]) => `<div class="tip-amt" data-tip="${v}">${l}</div>`).join("")}</div>
           <div class="note">100% goes to ${r.operatorName}. Recorded only — no card is charged in this demo.</div>`
        : "")}
    <button class="ghost" id="homeBtn" style="margin-top:18px">Back to home</button>`;
  $("backBtn").onclick = renderHome;
  $("homeBtn").onclick = renderHome;
  const tt = $("trackTip");
  if (tt) tt.querySelectorAll(".tip-amt").forEach((el) => el.onclick = async () => {
    let amt;
    if (el.dataset.tip === "custom") { amt = parseInt(prompt("Tip amount ($)", "30") || "0", 10); if (!amt || amt < 1) return; }
    else amt = parseInt(el.dataset.tip, 10);
    tt.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel");
    try { await backend.setTipRating(r.id, { tip: { amount: amt, mock: true } }); } catch (_) {}
    banner("♥", "Thanks sent", "$" + amt + " tip recorded for " + r.operatorName + ".");
    renderTrack();
  });
}

function renderReady(r) {
  go("ready");
  const f = FLOWS[r.type];
  root.innerHTML = `
    <div class="back" id="backBtn">‹ Back</div>
    <div class="center-pad">
      <div class="seal">${f.finalKind === "departure" ? "✈" : "🅿️"}</div>
      <h2>${f.completeTitle}</h2>
      <p>${r.tail} is all set. ${f.finalKind === "departure" ? "Safe flight." : "Welcome to Jay's."}</p>
      <div class="track-hero" style="margin-top:26px;width:100%">
        <div class="small">${f.completeSpotLabel}</div>
        <div class="big" style="font-size:24px">${r.spot || r.home}</div>
        <div class="spot">${r.operatorName || "Jay's line"} · ${fmtTime(new Date(r.updatedAt || Date.now()))}</div>
      </div>
      <button class="primary" style="width:auto;margin:26px 20px 0;align-self:stretch" id="contBtn">Continue</button>
    </div>`;
  $("backBtn").onclick = renderHome;
  $("contBtn").onclick = () => renderDone(r);
}

// Post-completion "say thanks" page: tip the assigned lineman after the work is
// done, plus a star rating. If a tip was already added at request time we just
// acknowledge it.
function renderDone(r) {
  go("done");
  const alreadyTipped = !!r.tip;
  const linemanName = r.operatorName || "your lineman";
  let stars = r.rating || 0;
  let tipAmt = null; // newly selected post-completion tip
  const tips = [["10", "$10"], ["20", "$20"], ["40", "$40"], ["custom", "Custom"]];
  root.innerHTML = `
    <div class="back" id="backBtn">‹ Back</div>
    <div class="center-pad" style="justify-content:flex-start;padding-top:30px">
      <div class="seal ${alreadyTipped ? "gold" : ""}">${alreadyTipped ? "♥" : "🙏"}</div>
      <h2>${alreadyTipped ? "Thank you!" : "Say thanks"}</h2>
      <p>${alreadyTipped
        ? "$" + r.tip.amount + " tip recorded for " + linemanName + "."
        : linemanName + " handled your aircraft. Add a tip to say thanks — 100% goes to them."}</p>
      ${r.operatorName ? `<div class="crew-row" style="width:100%;margin-top:18px"><div class="pic">${initials(r.operatorName)}</div>
        <div class="info"><b>${r.operatorName}</b><span>Lineman · Jay's Air Center</span></div></div>` : ""}
      ${alreadyTipped ? "" : `<div class="section-label" style="width:100%;text-align:left;padding-left:0">Add a tip — optional</div>
        <div class="tip-grid" id="tipGrid">${tips.map(([v, l]) => `<div class="tip-amt" data-tip="${v}">${l}</div>`).join("")}</div>`}
      <div class="section-label" style="width:100%;text-align:left;padding-left:0">Rate your service</div>
      <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= stars ? "lit" : ""}">★</span>`).join("")}</div>
      <button class="primary" style="width:auto;margin:28px 20px 0;align-self:stretch" id="homeBtn">${alreadyTipped ? "Back to home" : "Submit"}</button>
    </div>`;
  $("backBtn").onclick = () => renderReady(r);
  const sp = [...root.querySelectorAll("#stars span")];
  sp.forEach((s, i) => s.onclick = () => { stars = i + 1; sp.forEach((x, j) => x.classList.toggle("lit", j < stars)); });
  const tg = $("tipGrid");
  if (tg) tg.querySelectorAll(".tip-amt").forEach((el) => el.onclick = () => {
    if (el.classList.contains("sel")) { // tap again to opt out — no tip
      el.classList.remove("sel"); tipAmt = null; return;
    }
    const v = el.dataset.tip;
    if (v === "custom") { const a = parseInt(prompt("Tip amount ($)", "30") || "0", 10); tipAmt = (!a || a < 1) ? null : a; }
    else tipAmt = parseInt(v, 10);
    tg.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
    if (tipAmt) el.classList.add("sel");
  });
  $("homeBtn").onclick = async () => {
    const patch = {};
    if (stars) patch.rating = stars;
    if (tipAmt) patch.tip = { amount: tipAmt, mock: true };
    if (Object.keys(patch).length) {
      try { await backend.setTipRating(r.id, patch); } catch (_) {}
      if (patch.tip) banner("♥", "Thanks sent", "$" + tipAmt + " tip recorded for " + linemanName + ".");
    }
    trackingId = null; renderHome();
  };
}

/* ----------------------------- activity ------------------------------- */
function renderActivity() {
  go("activity");
  const done = myRequests.filter((r) => r.status === "complete");
  root.innerHTML = `
    <div class="h-title">Activity</div><div class="h-sub">Every parking, staging and departure.</div>
    ${done.length ? done.map((r) => `<div class="act" data-open="${r.id}" style="cursor:pointer"><div class="dot">${stepIcon(FLOWS[r.type]?.completeTitle || "")}</div>
      <div class="t"><b>${FLOWS[r.type]?.completeTitle || "Completed"}</b>
      <span>${r.spot || r.home || ""} · ${r.operatorName || "Jay's line"}${r.tip ? " · tipped $" + r.tip.amount : ""}${r.rating ? " · " + r.rating + "★" : ""}</span></div>
      <div class="when">${fmtDate(r.updatedAt)}</div></div>`).join("")
      : `<div class="empty">No activity yet.</div>`}
    <div class="tabbar">
      <button id="homeTab"><span class="ti">⌂</span>Home</button>
      <button class="active"><span class="ti">≣</span>Activity</button>
    </div>`;
  root.querySelectorAll("[data-open]").forEach((el) => el.onclick = () => { trackingId = el.dataset.open; renderTrack(); });
  $("homeTab").onclick = renderHome;
}

/* ------------------------------ lineman ------------------------------- */
function renderLineman() {
  go("lineman");
  const open = queue.filter((r) => r.status !== "complete");
  const active = open.filter((r) => !r.scheduled);
  root.innerHTML = `
    <div class="ahead"><div class="brand">JAY'S <b>VALET</b> · LINE</div><div class="avatar">${session.avatar || "LN"}</div></div>
    <div class="h-title">Line queue</div>
    <div class="h-sub">${session.name} · lineman · ${active.length} active request${active.length === 1 ? "" : "s"}</div>
    ${active.length ? active.map(opCard).join("") : `<div class="empty">No active requests. New requests appear here in real time.</div>`}
    <div class="note" style="padding:22px 24px 0">New customer requests stream in live. Advancing a job notifies the customer instantly.</div>`;
  root.querySelectorAll("[data-adv]").forEach((b) => b.onclick = () => opAdvance(b.dataset.adv));
}

/* ------------------------------- owner -------------------------------- */
// FBO operator oversight. Read-only board of every request across the ramp —
// the owner does not place parking/staging requests, they monitor the crew.
function renderOwner() {
  go("owner");
  const open = queue.filter((r) => r.status !== "complete");
  const done = queue.filter((r) => r.status === "complete");
  const inProgress = queue.filter((r) => r.status === "inprogress");
  const unassigned = open.filter((r) => !r.operatorName);

  // Billing snapshot — every fuel order, service and valeted car is a billable
  // line item; tips are recorded separately and pass through 100% to the crew.
  const billableItems = queue.reduce((n, r) => n
    + (r.fuel && r.fuel !== "None" ? 1 : 0)
    + (r.services ? r.services.length : 0)
    + (r.cars && r.cars !== "0" ? parseInt(r.cars, 10) || 0 : 0), 0);
  const tipsTotal = queue.reduce((n, r) => n + (r.tip ? (r.tip.amount || 0) : 0), 0);

  // Line crew & workload — group active jobs by assigned lineman.
  const crew = new Map();
  inProgress.forEach((r) => {
    if (!r.operatorName) return;
    if (!crew.has(r.operatorName)) crew.set(r.operatorName, []);
    crew.get(r.operatorName).push(r);
  });

  const kpis = [
    ["Open", open.length, "across the ramp"],
    ["In progress", inProgress.length, "crew working now"],
    ["Unassigned", unassigned.length, "awaiting a lineman", unassigned.length ? "alert" : ""],
    ["Done today", done.length, "completed jobs"],
  ];

  root.innerHTML = `
    <div class="ahead"><div class="brand">JAY'S <b>VALET</b> · OVERSIGHT</div>
      <div style="display:flex;align-items:center;gap:8px"><span class="role-tag">owner</span><div class="avatar">${session.avatar || "GM"}</div></div></div>
    <div class="h-title">${session.greet || "Line activity"}</div>
    <div class="h-sub">${session.name} · FBO operator · live across the ramp</div>

    <div class="kpi-grid">${kpis.map(([label, n, sub, cls]) => `
      <div class="kpi ${cls || ""}"><div class="kpi-n">${n}</div>
        <div class="kpi-l">${label}</div><div class="kpi-s">${sub}</div></div>`).join("")}</div>

    ${unassigned.length ? `<div class="section-label alert-label">Needs attention · ${unassigned.length}</div>
      ${unassigned.map(ownerCard).join("")}` : `<div class="ok-banner">✓ Every request has a lineman assigned.</div>`}

    <div class="section-label">Line crew & workload</div>
    ${crew.size ? [...crew.entries()].map(([name, jobs]) => `
      <div class="crew-row crew-load"><div class="pic">${initials(name)}</div>
        <div class="info"><b>${name}</b><span>Lineman · Jay's Air Center</span></div>
        <div class="load-count"><b>${jobs.length}</b><span>active</span></div></div>`).join("")
      : `<div class="empty">No active jobs assigned right now.</div>`}

    <div class="section-label">Billing & tips today</div>
    <div class="bill-grid">
      <div class="bill"><div class="bill-n">${billableItems}</div><div class="bill-l">Billable line items</div></div>
      <div class="bill"><div class="bill-n">$${tipsTotal}</div><div class="bill-l">Tips to crew</div></div>
    </div>

    <div class="section-label">All requests</div>
    ${open.length ? open.map(ownerCard).join("") : `<div class="empty">No open requests right now.</div>`}
    ${done.length ? `<div class="section-label">Completed today</div>${done.slice(0, 5).map(ownerCard).join("")}` : ""}
    <div class="note" style="padding:22px 24px 0">Every request is logged and billable. Tap any card to see the full job detail and assigned lineman.</div>`;
  root.querySelectorAll("[data-detail]").forEach((el) => el.onclick = () => {
    const r = queue.find((x) => x.id === el.dataset.detail);
    if (r) renderOwnerDetail(r);
  });
}
function ownerCard(r) {
  const f = FLOWS[r.type] || {};
  let badge;
  if (r.status === "requested") badge = "● New";
  else if (r.status === "complete") badge = "● Complete";
  else badge = "● " + ((r.steps || [])[r.stepIndex || 0]?.[0] || "In progress");
  const details = [
    r.cars && r.cars !== "0" ? `${r.cars} ${r.cars === "1" ? "car" : "cars"} to valet` : null,
    r.fuel && r.fuel !== "None" ? r.fuel : null,
    ...(r.services || []),
    r.operatorName ? `Lineman: ${r.operatorName}` : "Unassigned",
    r.tip ? `♥ $${r.tip.amount} tip` : null,
    `→ ${r.spot || r.home}`,
  ].filter(Boolean);
  const badgeCls = r.status === "requested" ? "staged" : (r.status === "complete" ? "parked" : "inprog");
  return `<div class="crew-card ${r.type === "stage" ? "stage" : ""}" data-detail="${r.id}" style="cursor:pointer">
      <div class="top"><div>
      <div class="tail">${r.tail}</div>
      <div class="req">${f.title || r.type} · ${r.slot ? r.slot + " · " : ""}${r.customerName}</div></div>
      <span class="badge ${badgeCls}">${badge}</span></div>
      <div class="det">${details.map((d) => `<span class="tag">${d}</span>`).join("")}</div></div>`;
}
function renderOwnerDetail(r) {
  go("ownerDetail");
  const f = FLOWS[r.type] || {}; const steps = r.steps || []; const idx = r.stepIndex || 0;
  root.innerHTML = `
    <div class="back" id="backBtn">‹ Back to oversight</div>
    <div class="ahead" style="padding-top:0"><div class="brand">JAY'S <b>VALET</b> · OVERSIGHT</div>
      <span class="badge ${r.status === "complete" ? "parked" : "inprog"}">● ${r.status === "complete" ? "Complete" : "In progress"}</span></div>
    <div class="track-hero">
      <div class="small">${f.title || r.type} · ${r.customerName}</div>
      <div class="big">${r.tail}</div>
      <div class="spot">${r.spot || r.home}${r.slot ? " · " + r.slot : ""}</div>
    </div>
    <div class="steps">${steps.map((s, i) => {
      const cls = i < idx ? "done" : (i === idx && r.status !== "complete" ? "active" : (r.status === "complete" ? "done" : ""));
      const node = (i < idx || r.status === "complete") ? "✓" : (i + 1);
      return `<div class="step ${cls}"><div class="node">${node}</div><div class="rail"></div>
        <div class="lbl"><b>${s[0]}</b><span>${s[1]}</span></div></div>`;
    }).join("")}</div>
    <div class="section-label">Assigned lineman</div>
    ${r.operatorName
      ? `<div class="crew-row"><div class="pic">${initials(r.operatorName)}</div>
         <div class="info"><b>${r.operatorName}</b><span>Lineman · Jay's Air Center</span></div></div>`
      : `<div class="crew-row"><div class="pic">…</div>
         <div class="info"><b>Unassigned</b><span>No lineman has accepted this job yet</span></div></div>`}
    ${r.tip ? `<div class="note">♥ $${r.tip.amount} tip recorded for the lineman.</div>` : ""}
    ${r.rating ? `<div class="note">Customer rating: ${r.rating}★</div>` : ""}`;
  $("backBtn").onclick = renderOwner;
}
function opCard(r) {
  const steps = r.steps || [];
  const idx = r.stepIndex || 0;
  const f = FLOWS[r.type] || {};
  let btnLabel, badge;
  if (r.status === "requested") { btnLabel = "Accept request"; badge = "● New"; }
  else if (idx >= steps.length - 1) { btnLabel = "Complete ✓"; badge = "● Finishing"; }
  else { btnLabel = "Advance: " + (steps[idx + 1]?.[0] || "next"); badge = "● " + (steps[idx]?.[0] || "In progress"); }
  const details = [
    r.cars && r.cars !== "0" ? `${r.cars} ${r.cars === "1" ? "car" : "cars"} to valet` : null,
    r.fuel && r.fuel !== "None" ? r.fuel : null,
    ...(r.services || []),
    r.tip ? `♥ $${r.tip.amount} tip` : null,
    `→ ${r.spot || r.home}`,
  ].filter(Boolean);
  return `<div class="crew-card"><div class="top"><div>
      <div class="tail">${r.tail}</div>
      <div class="req">${f.title || r.type} · ${r.slot ? r.slot + " · " : ""}${r.customerName}</div></div>
      <span class="badge ${r.status === "requested" ? "staged" : "inprog"}">${badge}</span></div>
      <div class="det">${details.map((d) => `<span class="tag">${d}</span>`).join("")}</div>
      <div class="crew-act">
        <button class="sec" onclick="alert('Reassign / decline — coming after MVP.')">Reassign</button>
        <button class="adv" data-adv="${r.id}">${btnLabel}</button>
      </div></div>`;
}
async function opAdvance(id) {
  const r = queue.find((x) => x.id === id); if (!r) return;
  const steps = r.steps || []; const idx = r.stepIndex || 0;
  if (r.status === "requested") {
    const next = steps[1] || ["Lineman assigned", ""];
    return backend.updateRequest(id, {
      status: "inprogress", stepIndex: 1,
      operatorUid: session.uid, operatorName: session.name,
      notify: { title: next[0], body: next[1] },
    });
  }
  const next = idx + 1;
  const step = steps[next] || steps[steps.length - 1];
  const complete = next >= steps.length - 1;
  backend.updateRequest(id, {
    stepIndex: Math.min(next, steps.length - 1),
    status: complete ? "complete" : "inprogress",
    notify: { title: step[0], body: step[1] },
  });
}

/* ------------------------------ helpers ------------------------------- */
function banner(ico, title, body) {
  $("notifIco").textContent = ico; $("notifTitle").textContent = title; $("notifBody").textContent = body;
  const n = $("notif"); n.classList.add("show");
  clearTimeout(banner._t); banner._t = setTimeout(() => n.classList.remove("show"), 3400);
}
function stepIcon(label = "") {
  const l = label.toLowerCase();
  if (l.includes("car") || l.includes("valet")) return "🚗";
  if (l.includes("fuel")) return "⛽";
  if (l.includes("marshal") || l.includes("meeting") || l.includes("dispatch")) return "🚜";
  if (l.includes("parked") || l.includes("ramp")) return "🅿️";
  if (l.includes("staged") || l.includes("ready")) return "✈";
  if (l.includes("assigned")) return "🧑‍✈️";
  if (l.includes("service")) return "🧰";
  return "✓";
}
function initials(n = "") { return n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
function fmtTime(d) { let h = d.getHours(), m = d.getMinutes(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + " " + ap; }
function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts || Date.now());
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function ceil30(d) { const ms = 30 * 60000; return new Date(Math.ceil(d.getTime() / ms) * ms); }
function genSlots(kind) {
  const now = new Date(); const out = [];
  let start = kind === "depart" ? ceil30(new Date(now.getTime() + 120 * 60000)) : ceil30(new Date(now.getTime() + 30 * 60000));
  const n = kind === "depart" ? 5 : 4;
  for (let i = 0; i < n; i++) out.push(fmtTime(new Date(start.getTime() + i * 30 * 60000)));
  return out;
}
function friendlyAuthErr(e) {
  const m = (e && e.message) || "";
  if (m.includes("invalid-credential") || m.includes("wrong-password") || m.includes("user-not-found")) return "Email or password is incorrect.";
  if (m.includes("email-already-in-use")) return "That email already has an account — try signing in.";
  if (m.includes("weak-password")) return "Password should be at least 6 characters.";
  if (m.includes("Demo mode")) return m;
  return "Something went wrong. Please try again.";
}
