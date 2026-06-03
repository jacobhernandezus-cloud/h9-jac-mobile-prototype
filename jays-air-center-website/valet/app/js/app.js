// Jay's Valet — main app. Talks to the backend abstraction (live Firebase or
// demo), renders the member + operator experiences, and drives the live status
// loop: customer requests -> operator queue -> operator advances -> customer
// sees it update in real time and gets a notification.
import { getBackend, DEMO_USERS } from "./data.js";

let backend, session = null, version = "A"; // version A = tipping (Concierge), B = standard
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
const FLOWS = {
  stage: {
    title: "Request ramp staging", destSub: "departure", slotKind: "depart",
    timeLabel: "Scheduled departure",
    timeNote: "Scheduled departures only. Earliest available is 2 hours out — this keeps last-minute ramp traffic down.",
    showCars: true, showFuel: true, showServices: true, cta: "Confirm staging request",
    trackTitle: "Estimated ready", finalKind: "departure",
    completeTitle: "Staged & ready", completeSpotLabel: "Staged at", spot: "Row A · Spot 7",
    buildSteps(o) {
      const s = [
        ["Request received", "Line operator notified"],
        ["Operator assigned", "Your operator is on the way"],
        ["Staging on ramp", "Positioning your aircraft"],
      ];
      if (o.cars && o.cars !== "0")
        s.push(["Cars valeted", (o.cars === "1" ? "1 vehicle" : o.cars + " vehicles") + " parked in the staging area"]);
      if (o.fuel && o.fuel !== "None") s.push(["Fueling", o.fuel]);
      s.push(["Staged & ready", "Ready for departure at " + this.spot]);
      return s;
    },
  },
  announce: {
    title: "Announce arrival", destSub: "on final approach", quick: true,
    showServices: true, showFuel: true, cta: "Announce — I'm 15 min out",
    trackTitle: "Operator meeting your aircraft", finalKind: "arrival",
    completeTitle: "Parked on the ramp", completeSpotLabel: "Parked at", spot: null,
    buildSteps(o) {
      const s = [
        ["Arrival announced", "Line operator notified"],
        ["Operator dispatched", "Heading to the ramp"],
        ["Meeting aircraft", "Marshalling you in"],
      ];
      if (o.fuel && o.fuel !== "None") s.push(["Fueling", o.fuel]);
      if (o.services && o.services.length) s.push(["Services", o.services.join(" · ") + " before parking"]);
      s.push(["Parked on ramp", "Secured at your spot"]);
      return s;
    },
  },
  return: {
    title: "Return aircraft to ramp", destSub: "reposition to ramp", quick: true,
    showFuel: true, cta: "Request return to ramp",
    trackTitle: "Estimated ready", finalKind: "departure",
    completeTitle: "On the ramp", completeSpotLabel: "Repositioned to", spot: "Ramp",
    buildSteps(o) {
      const s = [
        ["Request received", "Line operator notified"],
        ["Operator assigned", "Your operator is on the way"],
        ["Repositioning", "Moving your aircraft to the ramp"],
      ];
      if (o.fuel && o.fuel !== "None") s.push(["Fueling", o.fuel]);
      s.push(["On the ramp", "Repositioned and ready"]);
      return s;
    },
  },
  arrive: {
    title: "Schedule arrival", destSub: "inbound to KSNA", slotKind: "arrive",
    timeLabel: "Estimated arrival",
    timeNote: "Pick a slot within the next ~2 hours so the operator is ready when you taxi in. Tap “Announce” when you're on final.",
    showServices: true, showFuel: true, scheduled: true, cta: "Confirm scheduled arrival",
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
  if (session.role === "operator") {
    unsubData = backend.watchQueue((list) => {
      queue = list;
      if (screen === "operator") renderOperator();
    });
  } else {
    backend.registerPush?.(session.uid); // live: register this device for push
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
  if (backend.mode === "live" && !session) return renderAuth();
  if (!session) return renderAuth();
  if (session.role === "operator") return renderOperator();
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
        <option value="owner" ${session?.role === "owner" ? "selected" : ""}>Owner</option>
        <option value="tenant" ${session?.role === "tenant" ? "selected" : ""}>Tenant</option>
        <option value="operator" ${session?.role === "operator" ? "selected" : ""}>Operator</option>
      </select>
      <select id="verSel" title="App version">
        <option value="A" ${version === "A" ? "selected" : ""}>Version A · tipping</option>
        <option value="B" ${version === "B" ? "selected" : ""}>Version B · no tip</option>
      </select>`;
    $("roleSel").onchange = (e) => { trackingId = null; backend.demoSwitch(e.target.value); };
    $("verSel").onchange = (e) => { version = e.target.value; route(); };
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
      <p class="tag">Summon your aircraft like a Tesla — request staging, schedule arrivals, track every step.</p>
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
  // Live: session carries name/role; aircraft fields may live on session or first request.
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
  const scheduled = myRequests.filter((r) => r.scheduled && r.status === "requested");
  const recent = myRequests.filter((r) => r.status === "complete").slice(0, 3);

  root.innerHTML = `
    <div class="ahead">
      <div class="brand">JAY'S <b>VALET</b></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="role-tag">${m.role}</span><div class="avatar">${m.avatar || "?"}</div>
      </div>
    </div>
    <div class="h-title">${m.greet}</div>
    <div class="h-sub">${m.sub}</div>

    <div class="ac-card">
      <div class="plane">✈</div>
      <span class="badge ${active ? "inprog" : "parked"}">● ${active ? "In progress" : "On the ramp"}</span>
      <div class="ac-tail" style="margin-top:12px">${m.tail}</div>
      <div class="ac-type">${m.aircraftType || ""}</div>
      <div class="ac-meta">
        <div><span>Home</span><b>${m.home}</b></div>
        <div><span>Status</span><b>${active ? "In progress" : "On the ramp"}</b></div>
      </div>
    </div>

    ${active ? `<div class="pending" id="activeCard"><div class="dot">✈</div>
      <div class="t"><b>${FLOWS[active.type]?.title || "Active request"} in progress</b>
      <span>Tap to track ${active.tail} live.</span></div><div>›</div></div>` : ""}

    <div class="section-label">Departure</div>
    <button class="primary" data-flow="stage">✈&nbsp; Request ramp staging</button>
    <div class="note">Scheduled departures only · earliest 2 hours out.</div>

    <div class="section-label">Arrival</div>
    <button class="primary dark" data-flow="arrive">🗓️&nbsp; Schedule arrival</button>
    <button class="ghost" data-flow="announce">🛬&nbsp; Announce arrival</button>

    <div class="section-label">On the ramp</div>
    <button class="ghost" data-flow="return">↩&nbsp; Return aircraft to ramp</button>
    ${m.billNote ? `<div class="note">${m.billNote}</div>` : ""}

    ${scheduled.map((r) => `<div class="pending"><div class="dot">🗓️</div>
      <div class="t"><b>Arrival scheduled — ${r.slot || "soon"}</b>
      <span>Tap “Announce arrival” when you're on final.</span></div></div>`).join("")}

    <div class="section-label">Recent activity</div>
    ${recent.length ? recent.map((r) => `<div class="act"><div class="dot">${stepIcon(FLOWS[r.type]?.completeTitle || "")}</div>
      <div class="t"><b>${FLOWS[r.type]?.completeTitle || "Completed"}</b>
      <span>${r.spot || r.home || ""} · ${r.operatorName || "Jay's line"}${r.tip ? " · tipped $" + r.tip.amount : ""}</span></div>
      <div class="when">${fmtDate(r.updatedAt)}</div></div>`).join("")
      : `<div class="empty">No completed requests yet. Make your first request above.</div>`}

    <div class="tabbar">
      <button class="active"><span class="ti">⌂</span>Home</button>
      <button id="actTab"><span class="ti">≣</span>Activity</button>
      <button id="moreTab"><span class="ti">☰</span>More</button>
    </div>`;

  root.querySelectorAll("[data-flow]").forEach((b) => b.onclick = () => openFlow(b.dataset.flow));
  const ac = $("activeCard"); if (ac) ac.onclick = () => { trackingId = active.id; renderTrack(); };
  $("actTab").onclick = renderActivity;
  $("moreTab").onclick = () => alert("Profile, aircraft & billing — coming after MVP sign-off.");
}

/* ----------------------------- request -------------------------------- */
let draft = {};
function openFlow(key) {
  const f = FLOWS[key]; const m = memberProfile();
  draft = { type: key, cars: "0", services: [], fuel: "None", slot: null };
  let h = `<div class="back" id="backBtn">‹ Back</div>
    <div class="h-title">${f.title}</div>
    <div class="h-sub">${m.tail} · ${m.aircraftType || ""} · ${f.destSub}</div>`;

  if (f.quick) {
    h += `<div class="section-label">When</div>
      <div class="opt sel"><div class="ico">${key === "return" ? "↩" : "🛬"}</div>
      <div class="body"><b>${key === "return" ? "Now" : "On final approach"}</b>
      <span>${key === "return" ? "Reposition to the ramp" : "Operator meets you in ~15 min"}</span></div><div class="check"></div></div>`;
  } else {
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
    const lbl = key === "announce" || key === "arrive" ? "Request services before parking" : "Services";
    h += `<div class="section-label">${lbl}</div><div class="chips" id="svcChips">` +
      ["Lav service", "Potable water", "Ground power", "Rental car", "Catering"].map((s) => `<div class="chip" data-svc="${s}">${s}</div>`).join("") +
      `</div>`;
  }
  h += `<button class="primary dark" style="margin:26px 20px 0" id="submitBtn">${f.cta}</button>`;
  root.innerHTML = h; go("request");

  $("backBtn").onclick = renderHome;
  bindOne("slotChips", "slot", (v) => draft.slot = v);
  bindOne("carChips", "car", (v) => draft.cars = v);
  bindOne("fuelChips", "fuel", (v) => draft.fuel = v);
  bindMulti("svcChips", "svc", () => {
    draft.services = [...root.querySelectorAll('#svcChips .chip.sel')].map((c) => c.dataset.svc);
  });
  $("submitBtn").onclick = submitFlow;
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

async function submitFlow() {
  const f = FLOWS[draft.type]; const m = memberProfile();
  const base = {
    type: draft.type, customerUid: session.uid, customerName: m.name, customerRole: m.role,
    tail: m.tail, aircraftType: m.aircraftType || "", home: m.home,
    slot: draft.slot, cars: draft.cars, fuel: draft.fuel, services: draft.services,
    spot: f.spot || m.home, version, status: "requested", stepIndex: 0,
    operatorUid: null, operatorName: null, tip: null, rating: null,
  };
  if (f.scheduled) {
    base.scheduled = true;
    await backend.createRequest(base);
    banner("🗓️", "Arrival scheduled", "A spot will be ready for " + (draft.slot || "your arrival") + ".");
    renderHome();
    return;
  }
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
    <div class="ahead"><div class="brand">JAY'S <b>VALET</b></div>
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
    ${r.operatorName ? `<div class="crew-row"><div class="pic">${initials(r.operatorName)}</div>
      <div class="info"><b>${r.operatorName}</b><span>Line operator · Jay's Air Center</span></div>
      <a class="call" href="tel:+19497555000">✆</a></div>` : ""}
    <button class="ghost" id="backBtn" style="margin-top:18px">‹ Back to home</button>`;
  $("backBtn").onclick = renderHome;
}

function renderReady(r) {
  go("ready");
  const f = FLOWS[r.type];
  root.innerHTML = `
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
  $("contBtn").onclick = () => (version === "A" && !r.tip) ? renderTip(r) : renderDone(r, false);
}

function renderTip(r) {
  go("tip");
  const amounts = [10, 20, 40, 60];
  let sel = 20;
  root.innerHTML = `
    <div class="back" id="backBtn">‹ Back</div>
    <div class="center-pad" style="justify-content:flex-start;padding-top:14px">
      <div class="seal gold">♥</div>
      <h2>Thank your operator</h2>
      <p>${r.operatorName || "Your operator"} handled your aircraft. 100% of tips go to the line operator.</p>
      <div class="tip-grid" id="tipGrid">
        ${amounts.map((a) => `<div class="tip-amt ${a === 20 ? "sel" : ""}" data-amt="${a}">$${a}</div>`).join("")}
        <div class="tip-amt" data-amt="custom">Custom<small>Enter amount</small></div>
      </div>
      <button class="primary" style="width:auto;margin:20px 20px 0;align-self:stretch" id="tipBtn">Send $20</button>
      <button class="linkbtn" style="margin-top:16px" id="noTip">Not this time</button>
      <div class="mock-note">MVP: tip is recorded but no real payment is processed yet. Stripe payout setup is a separate decision — see the briefing for George.</div>
    </div>`;
  const upd = () => $("tipBtn").textContent = sel ? "Send $" + sel : "Enter an amount";
  root.querySelectorAll(".tip-amt").forEach((el) => el.onclick = () => {
    root.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel");
    sel = el.dataset.amt === "custom" ? parseInt(prompt("Tip amount ($)", "30") || "0", 10) : parseInt(el.dataset.amt, 10);
    upd();
  });
  $("backBtn").onclick = () => renderReady(r);
  $("noTip").onclick = () => renderDone(r, false);
  $("tipBtn").onclick = async () => {
    await backend.setTipRating(r.id, { tip: { amount: sel, mock: true } });
    banner("♥", "Tip sent", "$" + sel + " recorded for " + (r.operatorName || "your operator") + ". Thank you!");
    renderDone({ ...r, tip: { amount: sel } }, true);
  };
}

function renderDone(r, tipped) {
  go("done");
  let stars = 0;
  root.innerHTML = `
    <div class="center-pad">
      <div class="seal ${tipped ? "gold" : ""}">${tipped ? "♥" : "✈"}</div>
      <h2>${tipped ? "Thank you!" : "How was your service?"}</h2>
      <p>${tipped ? "$" + r.tip.amount + " recorded for " + (r.operatorName || "your operator") + "."
        : "Your feedback helps the line operator."}</p>
      <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(() => "<span>★</span>").join("")}</div>
      <button class="primary" style="width:auto;margin:28px 20px 0;align-self:stretch" id="homeBtn">Back to home</button>
    </div>`;
  const sp = [...root.querySelectorAll("#stars span")];
  sp.forEach((s, i) => s.onclick = () => { stars = i + 1; sp.forEach((x, j) => x.classList.toggle("lit", j < stars)); });
  $("homeBtn").onclick = async () => {
    if (stars) { try { await backend.setTipRating(r.id, { rating: stars }); } catch (_) {} }
    trackingId = null; renderHome();
  };
}

/* ----------------------------- activity ------------------------------- */
function renderActivity() {
  go("activity");
  const done = myRequests.filter((r) => r.status === "complete");
  root.innerHTML = `
    <div class="h-title">Activity</div><div class="h-sub">Every staging, arrival and return.</div>
    ${done.length ? done.map((r) => `<div class="act"><div class="dot">${stepIcon(FLOWS[r.type]?.completeTitle || "")}</div>
      <div class="t"><b>${FLOWS[r.type]?.completeTitle || "Completed"}</b>
      <span>${r.spot || r.home || ""} · ${r.operatorName || "Jay's line"}${r.tip ? " · tipped $" + r.tip.amount : ""}${r.rating ? " · " + r.rating + "★" : ""}</span></div>
      <div class="when">${fmtDate(r.updatedAt)}</div></div>`).join("")
      : `<div class="empty">No activity yet.</div>`}
    <div class="tabbar">
      <button id="homeTab"><span class="ti">⌂</span>Home</button>
      <button class="active"><span class="ti">≣</span>Activity</button>
      <button id="moreTab2"><span class="ti">☰</span>More</button>
    </div>`;
  $("homeTab").onclick = renderHome;
  $("moreTab2").onclick = () => alert("Profile, aircraft & billing — coming after MVP sign-off.");
}

/* ----------------------------- operator ------------------------------- */
function renderOperator() {
  go("operator");
  const open = queue.filter((r) => r.status !== "complete");
  const active = open.filter((r) => !r.scheduled);
  const inbound = open.filter((r) => r.scheduled);
  root.innerHTML = `
    <div class="ahead"><div class="brand">JAY'S <b>VALET</b> · OPS</div><div class="avatar">${session.avatar || "OP"}</div></div>
    <div class="h-title">Line queue</div>
    <div class="h-sub">${session.name} · line operator · ${active.length} active · ${inbound.length} inbound</div>
    ${active.length ? active.map(opCard).join("") : `<div class="empty">No active requests. New requests appear here in real time.</div>`}
    ${inbound.length ? `<div class="section-label">Inbound (scheduled)</div>` + inbound.map((r) => `
      <div class="crew-card dim"><div class="top"><div><div class="tail">${r.tail}</div>
      <div class="req">Arrival · ETA ${r.slot || "—"} · ${r.customerName}</div></div>
      <span class="badge parked">● Inbound</span></div>
      <div class="det">${(r.services || []).map((s) => `<span class="tag">${s}</span>`).join("")}<span class="tag">→ ${r.home}</span></div></div>`).join("") : ""}
    <div class="note" style="padding:22px 24px 0">New customer requests stream in live. Advancing a job notifies the customer instantly.</div>`;
  root.querySelectorAll("[data-adv]").forEach((b) => b.onclick = () => opAdvance(b.dataset.adv));
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
    r.cars && r.cars !== "0" ? `${r.cars} cars to valet` : null,
    r.fuel && r.fuel !== "None" ? r.fuel : null,
    ...(r.services || []),
    `→ ${r.spot || r.home}`,
  ].filter(Boolean);
  return `<div class="crew-card"><div class="top"><div>
      <div class="tail">${r.tail}</div>
      <div class="req">${f.title || r.type} · ${r.slot ? r.slot + " · " : ""}${r.customerName}</div></div>
      <span class="badge inprog">${badge}</span></div>
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
    const next = steps[1] || ["Operator assigned", ""];
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
