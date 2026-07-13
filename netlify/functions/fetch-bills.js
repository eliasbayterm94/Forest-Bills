const { getStore } = require("@netlify/blobs");
const { getCompanyConfig, getQBEnvVars, matchesVendorFilter } = require("./company-config");
const { getValidAccessToken } = require("./qb-auth");

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token });
}

function blobKey(co) { const k = (co||"USA").toUpperCase(); return k === "USA" ? "bill-log" : `${k.toLowerCase()}-bill-log`; }

async function fetchQBBills(token, qb, config) {
  const base = `${qb.baseUrl}/v3/company/${qb.realmId}`;
  const allBills = [];
  let startPos = 1;
  while (true) {
    const query = `SELECT * FROM Bill WHERE TxnDate >= '2025-01-01' ORDERBY TxnDate DESC STARTPOSITION ${startPos} MAXRESULTS 100`;
    const res = await fetch(`${base}/query?query=${encodeURIComponent(query)}&minorversion=65`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await res.json();
    const bills = data.QueryResponse?.Bill || [];
    allBills.push(...bills);
    if (bills.length < 100) break;
    startPos += 100;
  }

  const vendorIds = [...new Set(allBills.map(b => b.VendorRef?.value).filter(Boolean))];
  const vendorMap = {};
  for (const vid of vendorIds) {
    try { const r = await fetch(`${base}/vendor/${vid}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); const d = await r.json(); vendorMap[vid] = d.Vendor?.DisplayName || vid; } catch { vendorMap[vid] = vid; }
  }

  return allBills
    .filter(b => matchesVendorFilter(vendorMap[b.VendorRef?.value] || b.VendorRef?.name || '', config))
    .map(b => ({
      id: b.Id, invoice_number: b.DocNumber || '—', invoice_date: b.TxnDate,
      due_date: b.DueDate, vendor: vendorMap[b.VendorRef?.value] || b.VendorRef?.name || '—',
      total_amount: b.TotalAmt || 0, balance: b.Balance || 0,
      currency: b.CurrencyRef?.value || config.currency,
      line_items: (b.Line || []).filter(l => l.DetailType === 'AccountBasedExpenseLineDetail').map(l => ({
        account: l.AccountBasedExpenseLineDetail?.AccountRef?.name || '—', amount: l.Amount || 0, description: l.Description || '',
      })),
      qb_url: `https://app.qbo.intuit.com/app/bill?txnId=${b.Id}`, source: 'quickbooks',
    }));
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  const params = event.queryStringParameters || {};
  const company = params.company || "USA";
  const config = getCompanyConfig(company);
  const qb = getQBEnvVars(config);

  if (event.httpMethod === "POST") {
    try {
      const bill = JSON.parse(event.body);
      const store = getBlobStore();
      const key = blobKey(company);
      let log = []; try { log = await store.get(key, { type: "json" }) || []; } catch {}
      if (!log.find(b => b.invoice_number === bill.invoice_number && b.vendor === bill.vendor)) {
        log.unshift({ ...bill, company, saved_at: new Date().toISOString() });
        await store.setJSON(key, log);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (e) { return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }; }
  }

  try {
    if (!qb.realmId) throw new Error(`QB_REALM_ID missing for ${config.entity}`);
    const token = await getValidAccessToken(qb, company);
    const [qbBills, persistentLog] = await Promise.all([
      fetchQBBills(token, qb, config),
      (async () => { try { return await getBlobStore().get(blobKey(company), { type: "json" }) || []; } catch { return []; } })(),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, bills: qbBills, log: persistentLog, count: qbBills.length, company }) };
  } catch (e) { console.error(`fetch-bills error [${company}]:`, e.message); return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }; }
};
