// ─── FOREST BILLS — GMAIL RE-AUTHORIZATION ────────────────────────────────────
// When Google invalidates a Gmail refresh token (invalid_grant), this function
// lets the user reconnect from the browser without touching env vars:
//   1. GET ?company=XX&key=<FOREST_API_KEY>  → redirects to Google consent
//   2. Google redirects back here with ?code&state → exchanges the code and
//      persists the new refresh token in Netlify Blobs (per company).
// scan-gmail prefers the blob token over the env var, so the fix is immediate.
// This endpoint does NOT use checkAuth: the Google callback carries no API key,
// so the init leg is gated by ?key= and the callback by an HMAC-signed state.

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { getCompanyConfig, getGmailEnvVars } = require("./company-config");

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token, consistency: "strong" });
}

function gmailTokenKey(co) {
  const k = (co || "USA").toUpperCase();
  return k === "USA" ? "gmail-refresh-token" : `${k.toLowerCase()}-gmail-refresh-token`;
}

function sign(co) {
  const secret = process.env.FOREST_API_KEY || "forest-bills";
  return crypto.createHmac("sha256", secret).update(co).digest("hex").slice(0, 32);
}

function page(title, body, ok) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;background:#1b203d;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#0f1226;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:40px;max-width:420px;text-align:center}
h1{font-size:18px;color:${ok ? "#7dc855" : "#e05252"}}p{font-size:13px;color:rgba(255,255,255,.75);line-height:1.5}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

exports.handler = async (event) => {
  const html = (status, title, body, ok) => ({ statusCode: status, headers: { "Content-Type": "text/html" }, body: page(title, body, ok) });
  try {
    const qs = event.queryStringParameters || {};
    const host = event.headers?.host || event.headers?.Host;
    const redirectUri = `https://${host}/.netlify/functions/gmail-auth`;

    // ── Callback leg (from Google) ──
    if (qs.code && qs.state) {
      const [co, sig] = qs.state.split(".");
      if (!co || sig !== sign(co)) return html(403, "Invalid request", "State validation failed. Start again from Settings → Reconnect Gmail.", false);
      const env = getGmailEnvVars(getCompanyConfig(co));
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: qs.code, client_id: env.clientId, client_secret: env.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      const tok = await res.json();
      if (!tok.refresh_token) {
        const detail = tok.error_description || tok.error || "no refresh_token returned";
        return html(400, "Reconnection failed", `Google did not return a new token (${detail}). Open <b>myaccount.google.com/permissions</b> with the ${co} billing mailbox, remove this app's access, and try Reconnect Gmail again.`, false);
      }
      // Look up which mailbox was actually connected so the user can verify
      // they signed in with the billing account, not a personal one
      let email = null;
      try {
        const prof = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
        email = prof.emailAddress || null;
      } catch {}
      await getBlobStore().setJSON(gmailTokenKey(co), { refresh_token: tok.refresh_token, connected_at: new Date().toISOString(), email });
      return html(200, `Gmail reconnected for ${co} ✓`, `Connected mailbox: <b>${email || "unknown"}</b>.<br><br>If that is NOT the billing mailbox, run Reconnect Gmail again and pick the right account. Otherwise close this tab and run Scan Gmail.`, true);
    }

    // ── Init leg (from Settings button) ──
    const co = (qs.company || "USA").toUpperCase();
    const apiKey = process.env.FOREST_API_KEY;
    if (apiKey && qs.key !== apiKey) return html(401, "Unauthorized", "Missing or invalid key. Open this from Settings → Reconnect Gmail.", false);
    const env = getGmailEnvVars(getCompanyConfig(co));
    if (!env.clientId || !env.clientSecret) return html(400, "Not configured", `Gmail OAuth client is not configured for ${co}.`, false);
    const params = new URLSearchParams({
      client_id: env.clientId, redirect_uri: redirectUri, response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.modify",
      access_type: "offline", prompt: "consent", state: `${co}.${sign(co)}`,
    });
    return { statusCode: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }, body: "" };
  } catch (e) {
    return html(500, "Error", e.message, false);
  }
};

module.exports.gmailTokenKey = gmailTokenKey;
