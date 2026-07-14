const { getStore } = require("@netlify/blobs");

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  // strong: this handler does read-modify-write; a stale read would resurrect old statuses
  return getStore({ name: "forest-bills", siteID, token, consistency: "strong" });
}

function blobKey(co) { const k = (co||"USA").toUpperCase(); return k === "USA" ? "pending-invoices" : `${k.toLowerCase()}-pending-invoices`; }

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    // Accepts a single invoice_id or a bulk invoice_ids array (one blob write for all,
    // avoiding the lost-update race of many sequential read-modify-write requests)
    const { invoice_id, invoice_ids, status, bill_id, qb_url, company } = JSON.parse(event.body);
    const ids = new Set(Array.isArray(invoice_ids) ? invoice_ids : (invoice_id ? [invoice_id] : []));
    if (!ids.size || !status) return { statusCode: 400, headers, body: JSON.stringify({ error: "invoice_id(s) and status required" }) };
    const store = getBlobStore();
    const key = blobKey(company);
    let pending = []; try { pending = await store.get(key, { type: "json" }) || []; } catch {}
    let matched = 0;
    const updated = pending.map(inv => ids.has(inv.id) ? (matched++, { ...inv, status, bill_id, qb_url, updated_at: new Date().toISOString() }) : inv);
    await store.setJSON(key, updated);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, matched, requested: ids.size }) };
  } catch (err) { return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }; }
};
