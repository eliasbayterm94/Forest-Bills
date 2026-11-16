// ─── FOREST BILLS — BACKGROUND EXTRACTION WORKER ──────────────────────────────
// Netlify runs any function named *-background asynchronously with a 15-minute
// limit (the invocation returns 202 at once). Long invoices (Vollers outbound,
// 6+ pages with 50-90 positions) exceed the 26s sync limit — especially when
// the totals check adds a corrective retry — so process-bill enqueues a job
// blob and triggers this worker, which runs the same extraction logic and
// writes the result back into the job blob for the app to poll.

const processBill = require("./process-bill");
const { getStore } = require("@netlify/blobs");

function getJobStore() {
  const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token, consistency: "strong" });
}

exports.handler = async (event) => {
  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  let jobId;
  try { jobId = JSON.parse(event.body || "{}").job_id; } catch {}
  if (!/^[\w.-]{1,80}$/.test(jobId || "")) return { statusCode: 400, body: "job_id required" };

  const key = `extract-job-${jobId}`;
  const store = getJobStore();
  const job = await store.get(key, { type: "json" }).catch(() => null);
  if (!job?.payload) {
    console.warn(`Job ${jobId} not found or has no payload`);
    return { statusCode: 404, body: "Job not found" };
  }

  await store.setJSON(key, { ...job, status: "working", started_at: new Date().toISOString() });

  try {
    const res = await processBill.handler({
      httpMethod: "POST",
      headers: { "x-api-key": process.env.FOREST_API_KEY || "" },
      body: JSON.stringify({ ...job.payload, mode: job.payload.mode || "preview" }),
    });
    const data = (() => { try { return JSON.parse(res.body || "{}"); } catch { return {}; } })();
    // The finished job replaces the whole blob (payload included) so the PDF
    // doesn't pile up in storage; only the small result remains
    if (res.statusCode === 200 && data.success) {
      await store.setJSON(key, {
        status: "done", finished_at: new Date().toISOString(),
        extracted: data.extracted, filename: data.filename, company: data.company,
      });
    } else {
      await store.setJSON(key, {
        status: "error", finished_at: new Date().toISOString(),
        error: data.error || `Extraction failed (HTTP ${res.statusCode})`,
      });
    }
  } catch (e) {
    console.error(`Background extraction ${jobId} crashed:`, e);
    try { await store.setJSON(key, { status: "error", finished_at: new Date().toISOString(), error: e.message }); } catch {}
  }
  return { statusCode: 200 };
};
