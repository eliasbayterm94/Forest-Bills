// ─── FOREST BILLS — DAILY SCHEDULED SCAN WRAPPER ──────────────────────────────
// Netlify blocks direct HTTP calls to functions that have a `schedule` (403),
// which broke the frontend's manual "Scan Gmail" button. So the cron lives on
// this wrapper and scan-gmail stays a normal HTTP function; both run the same
// logic. Scanning all companies is triggered by sending a body without company.
// Every run writes a heartbeat to the automation-status blob so the Settings
// page can show whether the daily scan actually ran and what it found.

const scanGmail = require("./scan-gmail");
const { getStore } = require("@netlify/blobs");

async function writeHeartbeat(entry) {
  try {
    const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token) return;
    const store = getStore({ name: "forest-bills", siteID, token, consistency: "strong" });
    const cur = (await store.get("automation-status", { type: "json" }).catch(() => null)) || {};
    await store.setJSON("automation-status", { ...cur, scan: entry });
  } catch (e) { console.warn("Heartbeat write failed:", e.message); }
}

exports.handler = async () => {
  const event = {
    httpMethod: "POST",
    headers: { "x-nf-event": "schedule" },
    body: JSON.stringify({ next_run: null }),
  };
  try {
    const res = await scanGmail.handler(event);
    console.log("Scheduled scan finished:", res.statusCode, (res.body || "").slice(0, 1000));
    let results = [];
    try { results = JSON.parse(res.body).results || []; } catch {}
    await writeHeartbeat({
      ran_at: new Date().toISOString(),
      ok: res.statusCode === 200 && !results.some(r => r.error),
      results: results.map(r => ({ company: r.company, saved: r.saved ?? null, remaining: r.remaining ?? 0, error: r.error || null })),
    });
    return { statusCode: 200 };
  } catch (e) {
    console.error("Scheduled scan crashed:", e.message);
    await writeHeartbeat({ ran_at: new Date().toISOString(), ok: false, error: e.message });
    return { statusCode: 500 };
  }
};
