// ─── FOREST BILLS — DAILY SCHEDULED SCAN WRAPPER ──────────────────────────────
// Netlify blocks direct HTTP calls to functions that have a `schedule` (403),
// which broke the frontend's manual "Scan Gmail" button. So the cron lives on
// this wrapper and scan-gmail stays a normal HTTP function; both run the same
// logic. Scanning all companies is triggered by sending a body without company.

const scanGmail = require("./scan-gmail");

exports.handler = async () => {
  const event = {
    httpMethod: "POST",
    headers: { "x-nf-event": "schedule" },
    body: JSON.stringify({ next_run: null }),
  };
  const res = await scanGmail.handler(event);
  console.log("Scheduled scan finished:", res.statusCode, (res.body || "").slice(0, 1000));
  return { statusCode: 200 };
};
