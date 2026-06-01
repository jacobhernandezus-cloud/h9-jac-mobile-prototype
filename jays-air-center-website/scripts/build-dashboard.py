#!/usr/bin/env python3
"""
Build a static H9-branded HTML dashboard for the Jay's Air Center A/B test.

Pulls events from the openavdb-prod Firebase project (named DB: openavdb,
collection: jac_analytics_events) using your local gcloud auth, computes
funnel/variant/engagement metrics, and writes a self-contained HTML file
with all data embedded inline.

Usage:
    cd apps/jays-air-center-website
    python3 scripts/build-dashboard.py
    open docs/dashboard.html

Prerequisites:
    gcloud auth login        # (one-time, picks up your existing browser session)
    gcloud auth application-default login   # (only if print-access-token fails)

Re-run any time you want a fresh snapshot. The script overwrites docs/dashboard.html.
"""

import json
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path

PROJECT = "openavdb-prod"
DATABASE = "openavdb"
COLLECTION = "jac_analytics_events"

REPO_ROOT = Path(__file__).resolve().parent.parent  # apps/jays-air-center-website/
OUTPUT = REPO_ROOT / "docs" / "dashboard.html"

VARIANT_ORDER = ["join_waitlist", "reserve_your_hangar", "inquire_availability"]
VARIANT_LABEL = {
    "join_waitlist": "Join Waitlist",
    "reserve_your_hangar": "Reserve Your Hangar",
    "inquire_availability": "Inquire About Availability",
}
FUNNEL_STEPS = [
    ("page_view", "Page view"),
    ("section_viewed", "Section viewed"),
    ("cta_clicked", "CTA clicked"),
    ("form_started", "Form started"),
    ("form_completed", "Form completed"),
]


# ---------------------------------------------------------------------------
# Data fetch
# ---------------------------------------------------------------------------

def get_access_token() -> str:
    """Use the user's gcloud auth to get a short-lived access token."""
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"], stderr=subprocess.PIPE
        ).decode().strip()
        if not token:
            raise RuntimeError("empty token from gcloud")
        return token
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        sys.exit(
            "Failed to get a gcloud access token. Run `gcloud auth login` then retry.\n"
            f"  Underlying error: {exc}"
        )


def fetch_events(token: str) -> list[dict]:
    """Pull every document in the analytics collection via Firestore REST."""
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}/"
        f"databases/{DATABASE}/documents:runQuery"
    )
    body = json.dumps({"structuredQuery": {"from": [{"collectionId": COLLECTION}]}}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read())
    return [r["document"] for r in rows if r.get("document")]


def fval(doc: dict, path: str):
    """Walk Firestore's typed-value JSON shape."""
    cur = doc.get("fields", {})
    for p in path.split("."):
        if not isinstance(cur, dict):
            return None
        v = cur.get(p)
        if v is None:
            return None
        if "stringValue" in v:
            cur = v["stringValue"]
        elif "booleanValue" in v:
            cur = v["booleanValue"]
        elif "mapValue" in v:
            cur = v["mapValue"].get("fields", {})
        elif "integerValue" in v:
            cur = int(v["integerValue"])
        elif "timestampValue" in v:
            cur = v["timestampValue"]
        elif "nullValue" in v:
            cur = None
        else:
            return None
    return cur


def is_cli_test(doc: dict) -> bool:
    """Heuristic: did this event come from our CLI smoke tests?"""
    props = doc.get("fields", {}).get("properties", {}).get("mapValue", {}).get("fields", {})
    if any(k in props for k in ("smoke_test", "verification_run", "final_check", "status_check", "from")):
        return True
    vid = fval(doc, "visitor_id") or ""
    if vid.startswith("00000000-") or "FINAL-CONFIRM" in vid or "PROD1" in vid:
        return True
    return False


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def compute_metrics(docs: list[dict]) -> dict:
    cli = [d for d in docs if is_cli_test(d)]
    real = [d for d in docs if not is_cli_test(d)]

    # Funnel counts per variant (event-level, not unique-visitor-level)
    funnel = {v: Counter() for v in VARIANT_ORDER}
    for d in real:
        var = fval(d, "ab_variant")
        ev = fval(d, "event")
        if var in funnel and ev:
            funnel[var][ev] += 1

    # Sticky variant per unique visitor
    vid_to_variant = {}
    for d in real:
        vid = fval(d, "visitor_id")
        var = fval(d, "ab_variant")
        if vid and var and vid not in vid_to_variant:
            vid_to_variant[vid] = var
    visitors_per_variant = Counter(vid_to_variant.values())

    # Conversion rate per variant: form_completed / cta_clicked (event counts).
    # When cta_clicked == 0, we report None (n/a) rather than division-by-zero.
    conv = {}
    for v in VARIANT_ORDER:
        clicks = funnel[v]["cta_clicked"]
        completes = funnel[v]["form_completed"]
        conv[v] = (completes / clicks * 100) if clicks else None

    # Engagement: section_viewed counts by section
    sections = Counter()
    for d in real:
        if fval(d, "event") == "section_viewed":
            sec = fval(d, "properties.section")
            if sec:
                sections[sec] += 1

    # Time series by hour (UTC)
    by_hour = Counter()
    for d in real:
        ts = fval(d, "ts")
        if ts:
            by_hour[ts[:13].replace("T", " ")] += 1

    # Referrers, devices, countries
    referrers = Counter(fval(d, "referrer") for d in real if fval(d, "referrer"))
    devices = Counter(fval(d, "device") for d in real if fval(d, "device"))
    countries = Counter(fval(d, "country") for d in real if fval(d, "country"))

    # Recent activity: last 20 events sorted by ts
    sorted_real = sorted(real, key=lambda d: fval(d, "ts") or "", reverse=True)
    recent = []
    for d in sorted_real[:20]:
        recent.append({
            "ts": fval(d, "ts") or "",
            "event": fval(d, "event") or "?",
            "variant": fval(d, "ab_variant") or "?",
            "vid_short": (fval(d, "visitor_id") or "")[:8],
            "page": fval(d, "page_path") or "/",
            "device": fval(d, "device") or "?",
            "country": fval(d, "country") or "?",
            "section": fval(d, "properties.section") or "",
        })

    # Top-of-page KPIs
    now = datetime.now(timezone.utc)
    last_24h_cutoff = (now.timestamp() - 86400)
    events_24h = sum(
        1 for d in real
        if fval(d, "ts") and datetime.fromisoformat(fval(d, "ts").replace("Z", "+00:00")).timestamp() > last_24h_cutoff
    )

    return {
        "total_events": len(docs),
        "cli_events": len(cli),
        "real_events": len(real),
        "unique_visitors": len(vid_to_variant),
        "events_24h": events_24h,
        "funnel": funnel,
        "visitors_per_variant": visitors_per_variant,
        "conv_rate": conv,
        "sections": sections,
        "by_hour": by_hour,
        "referrers": referrers,
        "devices": devices,
        "countries": countries,
        "recent": recent,
        "generated_at": now.strftime("%Y-%m-%d %H:%M UTC"),
    }


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

def kpi_card(label: str, value, sub: str = "") -> str:
    return f"""
    <div class="kpi">
      <div class="kpi-label">{escape(label)}</div>
      <div class="kpi-value">{value}</div>
      {f'<div class="kpi-sub">{escape(sub)}</div>' if sub else ''}
    </div>
    """


def bar_chart_horizontal(rows: list[tuple[str, int]], max_value: int = None) -> str:
    if not rows:
        return '<p class="empty">No data yet.</p>'
    maxv = max_value or max(n for _, n in rows) or 1
    items = []
    for label, n in rows:
        pct = (n / maxv * 100) if maxv else 0
        items.append(f"""
        <div class="bar-row">
          <div class="bar-label">{escape(str(label))}</div>
          <div class="bar-track"><div class="bar-fill" style="width: {pct:.1f}%;"></div></div>
          <div class="bar-value">{n}</div>
        </div>
        """)
    return '<div class="bar-chart">' + "".join(items) + "</div>"


def funnel_chart(funnel: dict, visitors_per_variant: Counter) -> str:
    # Side-by-side funnel: each variant column shows the 5 steps as bars
    # scaled to that variant's own page_view count.
    cols = []
    for v in VARIANT_ORDER:
        c = funnel[v]
        max_for_variant = c["page_view"] or 1
        visitors = visitors_per_variant.get(v, 0)
        steps_html = []
        for ev_key, ev_label in FUNNEL_STEPS:
            n = c[ev_key]
            pct = (n / max_for_variant * 100) if max_for_variant else 0
            steps_html.append(f"""
            <div class="funnel-step">
              <div class="funnel-step-label">{escape(ev_label)}</div>
              <div class="funnel-step-bar"><div class="funnel-step-fill" style="width: {pct:.0f}%;"></div></div>
              <div class="funnel-step-value">{n}</div>
            </div>
            """)
        cols.append(f"""
        <div class="funnel-col">
          <div class="funnel-col-head">
            <div class="funnel-col-title">{escape(VARIANT_LABEL[v])}</div>
            <div class="funnel-col-sub">{visitors} {"visitor" if visitors == 1 else "visitors"}</div>
          </div>
          <div class="funnel-steps">{"".join(steps_html)}</div>
        </div>
        """)
    return '<div class="funnel">' + "".join(cols) + "</div>"


def conversion_chart(conv: dict, funnel: dict) -> str:
    rows = []
    for v in VARIANT_ORDER:
        rate = conv[v]
        clicks = funnel[v]["cta_clicked"]
        completes = funnel[v]["form_completed"]
        if rate is None:
            display = '<span class="conv-na">no clicks yet</span>'
            pct = 0
        else:
            display = f"{rate:.1f}%"
            pct = rate
        rows.append(f"""
        <div class="conv-row">
          <div class="conv-label">{escape(VARIANT_LABEL[v])}</div>
          <div class="conv-track"><div class="conv-fill" style="width: {min(pct, 100):.1f}%;"></div></div>
          <div class="conv-value">{display}</div>
          <div class="conv-detail">{completes} / {clicks}</div>
        </div>
        """)
    return '<div class="conv-chart">' + "".join(rows) + "</div>"


def recent_table(recent: list[dict]) -> str:
    if not recent:
        return '<p class="empty">No events yet.</p>'
    rows_html = []
    for r in recent:
        time_short = r["ts"][11:19] if r["ts"] else ""
        date_short = r["ts"][:10] if r["ts"] else ""
        section_extra = f" · {escape(r['section'])}" if r["section"] else ""
        rows_html.append(f"""
        <tr>
          <td class="t-time">{escape(date_short)}<br><span class="t-sub">{escape(time_short)}</span></td>
          <td class="t-event">{escape(r['event'])}{section_extra}</td>
          <td class="t-variant">{escape(VARIANT_LABEL.get(r['variant'], r['variant']))}</td>
          <td class="t-page">{escape(r['page'])}</td>
          <td class="t-meta">{escape(r['device'])} · {escape(r['country'])}</td>
          <td class="t-vid">{escape(r['vid_short'])}…</td>
        </tr>
        """)
    return f"""
    <table class="activity">
      <thead>
        <tr>
          <th>When (UTC)</th><th>Event</th><th>Variant</th><th>Page</th><th>Device · Country</th><th>Visitor</th>
        </tr>
      </thead>
      <tbody>{"".join(rows_html)}</tbody>
    </table>
    """


def render_html(m: dict) -> str:
    # KPIs row
    kpis = (
        kpi_card("Browser events", m["real_events"], f"{m['cli_events']} excluded CLI tests")
        + kpi_card("Unique visitors", m["unique_visitors"])
        + kpi_card("Events · last 24h", m["events_24h"])
        + kpi_card("Total stored", m["total_events"], "Persists in Firestore")
    )

    # Variant distribution
    var_rows = [(VARIANT_LABEL[v], m["visitors_per_variant"].get(v, 0)) for v in VARIANT_ORDER]
    variant_chart = bar_chart_horizontal(var_rows)

    # Conversion
    conv_html = conversion_chart(m["conv_rate"], m["funnel"])

    # Funnel
    funnel_html = funnel_chart(m["funnel"], m["visitors_per_variant"])

    # Engagement by section
    section_rows = [(s, n) for s, n in m["sections"].most_common()]
    section_chart = bar_chart_horizontal(section_rows)

    # Timeline
    hours_sorted = sorted(m["by_hour"].items())
    timeline_chart = bar_chart_horizontal(hours_sorted)

    # Sources / devices
    ref_rows = [(r, n) for r, n in m["referrers"].most_common(5)]
    ref_chart = bar_chart_horizontal(ref_rows) if ref_rows else '<p class="empty">No referrers captured yet (all visits direct).</p>'

    device_rows = [(d, n) for d, n in m["devices"].most_common()]
    device_chart = bar_chart_horizontal(device_rows)

    country_rows = [(c, n) for c, n in m["countries"].most_common()]
    country_chart = bar_chart_horizontal(country_rows)

    # Recent table
    recent_html = recent_table(m["recent"])

    template = HTML_TEMPLATE
    return template.format(
        generated_at=escape(m["generated_at"]),
        kpis=kpis,
        funnel=funnel_html,
        conversion=conv_html,
        variants=variant_chart,
        sections=section_chart,
        timeline=timeline_chart,
        referrers=ref_chart,
        devices=device_chart,
        countries=country_chart,
        recent=recent_html,
    )


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Jay's Air Center · Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Geologica:wght@700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root {{
  --orange:#FF8C00; --orange-glow:rgba(255,140,0,0.35); --orange-soft:rgba(255,140,0,0.10);
  --navy:#142338; --navy-deep:#0c1626; --navy-soft:#1a2c47;
  --cream:#FAF8F4; --pearl:#F0F0F0; --text:#1E1E1E; --muted:#5a6573;
  --rule:rgba(20,35,60,0.08); --rule-strong:rgba(20,35,60,0.16);
  --sage:#6d8473; --rust:#b3613f;
}}
* {{ box-sizing: border-box; }}
html, body {{ margin:0; padding:0; background:var(--cream); color:var(--text); font-family:'Inter',Arial,sans-serif; font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }}
a {{ color:var(--navy); text-decoration:underline dotted var(--orange); text-decoration-thickness:1.5px; text-underline-offset:3px; }}
a:hover {{ color:var(--orange); }}
.doc {{ max-width:1100px; margin:0 auto; padding:40px 32px 56px; }}

/* Header */
header.top {{ display:flex; align-items:center; justify-content:space-between; margin-bottom:32px; }}
.brand {{ display:flex; align-items:center; gap:14px; }}
.logo-mark {{ width:36px; height:36px; border-radius:0.55rem; background:var(--navy); border:1.5px solid var(--orange); display:flex; align-items:center; justify-content:center; color:var(--orange); font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:15px; }}
.wordmark {{ font-family:'Geologica','Inter',sans-serif; font-weight:700; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:var(--navy); }}
.gen-stamp {{ font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.08em; color:var(--muted); }}

/* Eyebrow + title */
.eyebrow {{ display:flex; align-items:center; gap:10px; font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px; }}
.pulse-dot {{ width:8px; height:8px; background:var(--orange); border-radius:50%; box-shadow:0 0 12px var(--orange-glow); animation:pulse 2s ease-in-out infinite; }}
@keyframes pulse {{ 0%,100% {{opacity:1; transform:scale(1);}} 50% {{opacity:0.55; transform:scale(0.88);}} }}
h1 {{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:42px; letter-spacing:0.01em; line-height:1.05; text-transform:uppercase; color:var(--navy); margin:0 0 8px; }}
.subtitle {{ color:var(--muted); margin:0 0 36px; max-width:680px; font-size:16px; }}

/* Section headings */
h2 {{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:20px; letter-spacing:0.02em; line-height:1.1; text-transform:uppercase; color:var(--navy); margin:44px 0 6px; }}
.rule {{ width:56px; height:3px; background:var(--orange); box-shadow:0 0 12px var(--orange-glow); margin:0 0 20px; border-radius:1.5px; }}

/* KPI cards */
.kpis {{ display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:8px; }}
.kpi {{ background:#fff; border:1px solid var(--rule); border-radius:10px; padding:18px 20px; }}
.kpi-label {{ font-size:10px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }}
.kpi-value {{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; font-weight:800; font-size:32px; color:var(--navy); line-height:1.05; }}
.kpi-sub {{ font-size:11px; color:var(--muted); margin-top:6px; }}

/* Caveat banner */
.caveat {{ background:var(--orange-soft); border-left:3px solid var(--orange); border-radius:4px; padding:14px 18px; margin:18px 0 0; font-size:14px; color:var(--text); }}
.caveat strong {{ color:var(--navy); }}

/* Bar charts (generic horizontal) */
.bar-chart {{ display:flex; flex-direction:column; gap:8px; }}
.bar-row {{ display:grid; grid-template-columns:200px 1fr 60px; align-items:center; gap:12px; font-size:14px; }}
.bar-label {{ color:var(--text); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
.bar-track {{ background:var(--pearl); border-radius:4px; height:18px; overflow:hidden; }}
.bar-fill {{ background:linear-gradient(90deg, var(--orange) 0%, #ffaa3d 100%); height:100%; border-radius:4px; transition:width 0.3s ease; }}
.bar-value {{ font-family:'JetBrains Mono',monospace; font-weight:500; color:var(--navy); text-align:right; }}

/* Funnel side-by-side */
.funnel {{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }}
.funnel-col {{ background:#fff; border:1px solid var(--rule); border-radius:10px; padding:18px 20px; }}
.funnel-col-head {{ border-bottom:1px solid var(--rule); padding-bottom:12px; margin-bottom:14px; }}
.funnel-col-title {{ font-weight:700; color:var(--navy); font-size:15px; }}
.funnel-col-sub {{ font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-top:4px; font-family:'JetBrains Mono',monospace; }}
.funnel-steps {{ display:flex; flex-direction:column; gap:8px; }}
.funnel-step {{ display:grid; grid-template-columns:1fr 60px 32px; gap:8px; align-items:center; font-size:13px; }}
.funnel-step-label {{ color:var(--muted); }}
.funnel-step-bar {{ background:var(--pearl); border-radius:3px; height:8px; overflow:hidden; grid-column:1 / -1; margin-top:-4px; margin-bottom:4px; }}
.funnel-step-fill {{ background:var(--navy); height:100%; border-radius:3px; }}
.funnel-step-value {{ font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--navy); text-align:right; font-weight:500; }}

/* Use grid layout to make label + value sit on one row with the bar on the row below */
.funnel-step {{ display:grid; grid-template-columns:1fr auto; grid-template-rows:auto auto; column-gap:8px; row-gap:2px; align-items:center; font-size:13px; }}
.funnel-step-label {{ grid-column:1; grid-row:1; }}
.funnel-step-value {{ grid-column:2; grid-row:1; }}
.funnel-step-bar {{ grid-column:1 / -1; grid-row:2; margin:0; }}

/* Conversion rate chart */
.conv-chart {{ display:flex; flex-direction:column; gap:10px; }}
.conv-row {{ display:grid; grid-template-columns:220px 1fr 80px 80px; align-items:center; gap:12px; font-size:14px; padding:6px 0; }}
.conv-label {{ font-weight:600; color:var(--navy); }}
.conv-track {{ background:var(--pearl); border-radius:4px; height:24px; overflow:hidden; position:relative; }}
.conv-fill {{ background:linear-gradient(90deg, var(--orange) 0%, var(--rust) 100%); height:100%; border-radius:4px; }}
.conv-value {{ font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--navy); text-align:right; }}
.conv-detail {{ font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); text-align:right; }}
.conv-na {{ color:var(--muted); font-style:italic; font-size:13px; font-family:'Inter',sans-serif; font-weight:400; letter-spacing:0; }}

/* Two-column layouts */
.grid-2 {{ display:grid; grid-template-columns:1fr 1fr; gap:32px; }}

/* Activity table */
.activity {{ width:100%; border-collapse:collapse; font-size:13px; }}
.activity th {{ text-align:left; font-weight:600; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:var(--muted); padding:8px 12px 8px 0; border-bottom:1px solid var(--rule-strong); }}
.activity td {{ padding:10px 12px 10px 0; border-bottom:1px solid var(--rule); vertical-align:top; }}
.t-time {{ font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--navy); white-space:nowrap; }}
.t-time .t-sub {{ color:var(--muted); font-size:11px; }}
.t-event {{ font-weight:500; color:var(--navy); }}
.t-variant {{ color:var(--muted); font-size:12px; }}
.t-page {{ font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--text); }}
.t-meta {{ color:var(--muted); font-size:12px; }}
.t-vid {{ font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); }}

.empty {{ color:var(--muted); font-style:italic; padding:20px 0; }}

/* Footer */
footer {{ margin-top:56px; padding-top:24px; border-top:1px solid var(--rule); display:flex; justify-content:space-between; align-items:center; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); }}

@media (max-width: 900px) {{
  .kpis {{ grid-template-columns:repeat(2, 1fr); }}
  .funnel {{ grid-template-columns:1fr; }}
  .grid-2 {{ grid-template-columns:1fr; }}
  .conv-row {{ grid-template-columns:140px 1fr 60px 60px; }}
  .bar-row {{ grid-template-columns:120px 1fr 50px; }}
}}
</style>
</head>
<body>
<div class="doc">

  <header class="top">
    <div class="brand">
      <div class="logo-mark">H9</div>
      <div class="wordmark">H9 Partners</div>
    </div>
    <div class="gen-stamp">Generated {generated_at}</div>
  </header>

  <div class="eyebrow"><div class="pulse-dot"></div>Jay's Air Center · CTA Experiment Dashboard</div>
  <h1>Live Performance</h1>
  <p class="subtitle">Live snapshot of the 3-variant call-to-action A/B test running on jaysaircenter.com. Re-run <code>scripts/build-dashboard.py</code> to refresh.</p>

  <div class="kpis">
    {kpis}
  </div>

  <div class="caveat">
    <strong>Reading note.</strong> Early-experiment numbers include verification testing. CLI smoke tests (with tagged synthetic visitor IDs) are excluded automatically. Playwright/automated browser sessions during deployment can't be distinguished from real visitors yet — interpret variant-conversion rates cautiously until visitor counts pass 100 per variant.
  </div>

  <h2>Conversion Rate by Variant</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">form_completed / cta_clicked. This is the experiment's primary metric.</p>
  {conversion}

  <h2>Funnel by Variant</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">Step-by-step drop-off for each variant. Bars are scaled within each column (each variant's page_view = 100%) so you can compare drop-off shape, not absolute volume.</p>
  {funnel}

  <h2>Variant Assignment Distribution</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">Unique visitors per arm. In steady state with random traffic this should approach 33/33/33; large deviations at low volume are normal small-sample variance.</p>
  {variants}

  <div class="grid-2">
    <div>
      <h2>Section Engagement</h2><div class="rule"></div>
      <p class="subtitle" style="margin-bottom:18px;">Section_viewed counts. Which service offering is pulling attention?</p>
      {sections}
    </div>
    <div>
      <h2>Traffic by Hour (UTC)</h2><div class="rule"></div>
      <p class="subtitle" style="margin-bottom:18px;">Events per hour over the experiment window.</p>
      {timeline}
    </div>
  </div>

  <div class="grid-2">
    <div>
      <h2>Top Referrers</h2><div class="rule"></div>
      {referrers}
    </div>
    <div>
      <h2>Device &amp; Country</h2><div class="rule"></div>
      <div style="display:flex; flex-direction:column; gap:18px;">
        <div>{devices}</div>
        <div>{countries}</div>
      </div>
    </div>
  </div>

  <h2>Recent Activity</h2><div class="rule"></div>
  <p class="subtitle" style="margin-bottom:18px;">Last 20 browser-session events. Useful for sanity-checking that real traffic is landing.</p>
  {recent}

  <footer>
    <span>Confidential · H9 Partners</span>
    <span>Run scripts/build-dashboard.py to refresh</span>
  </footer>

</div>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Fetching events from {PROJECT}/{DATABASE}/{COLLECTION}...")
    token = get_access_token()
    docs = fetch_events(token)
    print(f"  pulled {len(docs)} documents")

    metrics = compute_metrics(docs)
    html = render_html(metrics)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Wrote dashboard to {OUTPUT}")
    print(f"  events: {metrics['total_events']} total, {metrics['real_events']} non-CLI, {metrics['unique_visitors']} unique visitors")
    print()
    print(f"Open with:  open {OUTPUT}")


if __name__ == "__main__":
    main()
