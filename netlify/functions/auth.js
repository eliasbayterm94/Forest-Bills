// ─── FOREST BILLS — AUTH HELPER ───────────────────────────────────────────────
// Validates API key from request headers against FOREST_API_KEY env var.
// All functions call checkAuth(event) before processing.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function checkAuth(event) {
  // Always allow OPTIONS (CORS preflight)
  if (event.httpMethod === "OPTIONS") return null;

  // Allow scheduled invocations (cron jobs / Run now button)
  // Netlify scheduled functions can be identified by:
  // - x-nf-event header set to "schedule"
  // - user-agent containing "Netlify Clockwork"
  // - body containing "next_run" (scheduled function payload)
  const nfEvent = event.headers?.["x-nf-event"] || event.headers?.["X-NF-Event"] || "";
  const userAgent = event.headers?.["user-agent"] || "";
  const bodyStr = event.body || "";
  if (nfEvent === "schedule" || userAgent.includes("Netlify Clockwork") || bodyStr.includes("next_run")) return null;

  const apiKey = process.env.FOREST_API_KEY;

  // If no API key is configured, allow all requests (backward compatible)
  if (!apiKey) return null;

  // Check header
  const provided = event.headers?.["x-api-key"] || event.headers?.["X-API-Key"];

  if (!provided || provided !== apiKey) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Unauthorized — invalid or missing API key" }),
    };
  }

  return null; // auth passed
}

module.exports = { checkAuth, CORS_HEADERS };
