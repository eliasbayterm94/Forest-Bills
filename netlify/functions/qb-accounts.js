// ─── FOREST BILLS — QB ACCOUNTS LIST ──────────────────────────────────────────
// Returns the active expense-type accounts of the company's QuickBooks so the
// app can offer a dropdown to correct a line item's account before pushing.
// Cached in the blob store for 6 hours; ?refresh=1 forces a re-fetch.

const { getStore } = require("@netlify/blobs");
const { getCompanyConfig, getQBEnvVars, getBlobKey } = require("./company-config");
const { getValidAccessToken } = require("./qb-auth");

const ACCOUNT_TYPES = ["Expense", "Other Expense", "Cost of Goods Sold"];
const TTL_MS = 6 * 60 * 60 * 1000;

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token });
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  try {
    const qs = event.queryStringParameters || {};
    const co = (qs.company || "USA").toUpperCase();
    const key = getBlobKey("qb-accounts", co);

    if (qs.refresh !== "1") {
      const cached = await getBlobStore().get(key, { type: "json" }).catch(() => null);
      if (cached?.accounts?.length && Date.now() - new Date(cached.cached_at).getTime() < TTL_MS) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, accounts: cached.accounts, cached: true }) };
      }
    }

    const config = getCompanyConfig(co);
    const qb = getQBEnvVars(config);
    if (!qb.realmId) throw new Error(`QB not configured for ${co}`);
    const token = await getValidAccessToken(qb, co);
    const q = "SELECT Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000";
    const res = await fetch(`${qb.baseUrl}/v3/company/${qb.realmId}/query?query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`QB accounts query failed: ${res.status}`);

    const accounts = (data.QueryResponse?.Account || [])
      .filter(a => ACCOUNT_TYPES.includes(a.AccountType))
      .map(a => a.FullyQualifiedName)
      .sort((x, y) => x.localeCompare(y));

    try { await getBlobStore().setJSON(key, { accounts, cached_at: new Date().toISOString() }); } catch {}
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, accounts, cached: false }) };
  } catch (err) {
    console.error("qb-accounts error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
