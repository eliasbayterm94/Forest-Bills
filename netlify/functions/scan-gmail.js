const { google } = require("googleapis");
const Anthropic = require("@anthropic-ai/sdk");
const { getStore } = require("@netlify/blobs");
const { getCompanyConfig, getGmailEnvVars, getAllCompanyKeys } = require("./company-config");
const { getVendorConfigs } = require("./vendor-config");
const { getSystemOverrides } = require("./vendor-config");

const Anthropic_client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  // strong: savePending does read-modify-write; stale reads would drop status updates
  return getStore({ name: "forest-bills", siteID, token, consistency: "strong" });
}

function blobKey(co) { const k = (co||"USA").toUpperCase(); return k === "USA" ? "pending-invoices" : `${k.toLowerCase()}-pending-invoices`; }

async function loadPending(co) { try { return await getBlobStore().get(blobKey(co), { type: "json" }) || []; } catch { return []; } }

async function savePending(invoices, co) {
  try {
    const store = getBlobStore(); const key = blobKey(co);
    const existing = await loadPending(co);

    // Cleanup: remove rejected/done invoices older than 3 days to keep blob small
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const cleaned = existing.filter(i => {
      if (i.status === 'pending') return true; // always keep pending
      const ts = new Date(i.scanned_at || 0).getTime();
      return ts > threeDaysAgo; // keep recent non-pending for dedup
    });

    const existingKeys = new Set(cleaned.map(i => `${i.filename}-${i.email_date}`));
    const newOnes = invoices.filter(i => !existingKeys.has(`${i.filename}-${i.date}`));
    const savedItems = newOnes.map(i => ({
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      filename: i.filename, pdf_base64: i.base64, email_from: i.from,
      email_subject: i.subject, email_date: i.date, source: "gmail",
      status: "pending", company: co || "USA", scanned_at: new Date().toISOString(),
    }));
    const updated = [...cleaned, ...savedItems];
    await store.setJSON(key, updated);
    return { count: newOnes.length, items: savedItems };
  } catch (e) { console.warn("Blob save failed:", e.message); return { count: 0, items: [] }; }
}

async function getGmailClient(env) {
  const oauth2 = new google.auth.OAuth2(env.clientId, env.clientSecret);
  oauth2.setCredentials({ refresh_token: env.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

function buildQuery(emails, startDate, companyKey) {
  const labelName = (!companyKey || companyKey === "USA") ? "forest-bills-done" : `forest-bills-${companyKey.toLowerCase()}-done`;
  // Cap the scan window to the last 10 days: with only startDate the window grew forever
  // and high-volume companies hit too many matches, so new invoices stopped coming in.
  // startDate still wins if it's more recent than 10 days ago (e.g. a newly onboarded company).
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 10);
  const startTs = Date.parse((startDate || "2026/04/07").replace(/\//g, "-"));
  const after = (startTs && startTs > cutoff.getTime()) ? new Date(startTs) : cutoff;
  const afterStr = `${after.getFullYear()}/${String(after.getMonth() + 1).padStart(2, "0")}/${String(after.getDate()).padStart(2, "0")}`;
  return [`from:(${emails.join(" OR ")})`, "has:attachment", "filename:pdf", `-label:${labelName}`, `after:${afterStr}`].join(" ");
}

async function getPDFAttachments(gmail, messageId) {
  const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const hdrs = msg.data.payload?.headers || [];
  const subject = hdrs.find(h => h.name === "Subject")?.value || "";
  const from = hdrs.find(h => h.name === "From")?.value || "";
  const date = hdrs.find(h => h.name === "Date")?.value || "";
  const pdfs = [];
  (function find(parts) { for (const p of parts || []) { if ((p.mimeType === "application/pdf" || p.filename?.toLowerCase().endsWith(".pdf")) && p.body?.attachmentId) pdfs.push({ filename: p.filename, attachmentId: p.body.attachmentId }); if (p.parts) find(p.parts); } })(msg.data.payload?.parts);
  const results = [];
  for (const pdf of pdfs) {
    try { const att = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: pdf.attachmentId }); results.push({ filename: pdf.filename, base64: att.data.data.replace(/-/g, "+").replace(/_/g, "/"), subject, from, date }); } catch (e) { console.error(`Failed: ${pdf.filename}`, e.message); }
  }
  return results;
}

async function isInvoice(b64) {
  try {
    const r = await Anthropic_client.messages.create({ model: "claude-opus-4-5", max_tokens: 150,
      messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: `Is this a payable invoice with amount due? Answer ONLY JSON: {"is_invoice":true/false,"reason":"one sentence"}\nNOT: statements, quotes, BOLs, delivery orders, packing lists, confirmations.\nIS: document requesting payment with invoice number + total.` }] }],
    });
    return JSON.parse(r.content[0].text.replace(/```json|```/g, "").trim()).is_invoice === true;
  } catch { return true; }
}

async function getOrCreateLabel(gmail, name) {
  const res = await gmail.users.labels.list({ userId: "me" });
  let id = res.data.labels?.find(l => l.name === name)?.id;
  if (!id) { const c = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelHide", messageListVisibility: "hide" } }); id = c.data.id; }
  return id;
}

async function scanCompany(co) {
  const config = getCompanyConfig(co);
  const env = getGmailEnvVars(config);
  if (!env.clientId || !env.refreshToken) return { company: co, invoices: [], saved: 0, skipped: 0, message: "Gmail not configured" };

  // Load dynamic vendor emails in parallel with Gmail setup
  const [dynamicResult, overrideResult, gmail] = await Promise.all([
    getVendorConfigs(co).catch(() => []),
    getSystemOverrides(co).catch(() => ({})),
    getGmailClient(env),
  ]);

  const dynamicEmails = (dynamicResult || []).filter(v => v.active).flatMap(v => v.emails || []);
  const dynamicInvoiceOnly = (dynamicResult || []).filter(v => v.active && v.options?.invoice_only_filename).flatMap(v => v.emails || []);
  const systemOverrideEmails = Object.values(overrideResult || {}).flat();

  const allEmails = [...config.vendorEmails, ...dynamicEmails, ...systemOverrideEmails];
  if (!allEmails.length) return { company: co, invoices: [], saved: 0, skipped: 0, message: "No vendors" };

  const invoiceOnlySenders = ['agcs.uk.com', 'shippgl.com', ...dynamicInvoiceOnly];

  const query = buildQuery(allEmails, env.startDate, co);
  const searchRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
  const messages = searchRes.data.messages || [];
  if (!messages.length) return { company: co, invoices: [], saved: 0, skipped: 0, message: "No new emails" };

  const labelName = co === "USA" ? "forest-bills-done" : `forest-bills-${co.toLowerCase()}-done`;
  const labelId = await getOrCreateLabel(gmail, labelName);
  const invoices = []; let skipped = 0;

  for (const msg of messages) {
    const pdfs = await getPDFAttachments(gmail, msg.id);
    if (!pdfs.length) continue;
    let any = false;
    for (const pdf of pdfs) {
      const fn = (pdf.filename || '').toLowerCase();
      const subj = (pdf.subject || '').toLowerCase();
      const from = (pdf.from || '').toLowerCase();
      if (fn.includes('signature') || fn.includes('logo') || fn.includes('banner')) { skipped++; continue; }
      if (subj.includes('customer statement') || subj.includes('statement of account') || fn.includes('statement')) { skipped++; continue; }
      const skipPatterns = ['proof of release', 'proof of delivery', 'packing list', 'packing_list',
        'pod tcku', 'pod_', 'delivery order', 'bill of lading'];
      if (skipPatterns.some(p => fn.includes(p))) { skipped++; continue; }
      if (invoiceOnlySenders.some(s => from.includes(s)) && !fn.includes('invoice')) { skipped++; continue; }
      invoices.push(pdf); any = true;
    }
    if (any) try { await gmail.users.messages.modify({ userId: "me", id: msg.id, requestBody: { addLabelIds: [labelId] } }); } catch {}
  }

  const saveResult = await savePending(invoices, co);
  return { company: co, invoices, saved: saveResult.count, savedItems: saveResult.items, skipped, count: invoices.length };
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  if (event.httpMethod === "GET") {
    const co = (event.queryStringParameters || {}).company || "USA";
    const invoiceId = (event.queryStringParameters || {}).id;
    const action = (event.queryStringParameters || {}).action;

    // Force cleanup: remove all non-pending invoices
    if (action === "cleanup") {
      const store = getBlobStore();
      const all = await loadPending(co);
      const pending = all.filter(i => i.status === "pending");
      await store.setJSON(blobKey(co), pending);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, removed: all.length - pending.length, remaining: pending.length }) };
    }

    const all = await loadPending(co);
    
    // If specific invoice ID requested, return with base64
    if (invoiceId) {
      const inv = all.find(i => i.id === invoiceId);
      if (inv) return { statusCode: 200, headers, body: JSON.stringify({ success: true, invoice: inv }) };
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Invoice not found" }) };
    }
    
    // List mode: return without base64 to stay under payload limit
    const pending = all.filter(i => i.status === "pending").map(i => ({
      id: i.id, filename: i.filename, email_from: i.email_from,
      email_subject: i.email_subject, email_date: i.email_date,
      source: i.source, status: i.status, company: i.company, scanned_at: i.scanned_at,
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, invoices: pending, count: pending.length, company: co }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    if (body.company) {
      const co = body.company.toUpperCase();

      // Rescan mode: remove the done label from recent emails first, then scan normally
      if (body.rescan) {
        try {
          const config = getCompanyConfig(co);
          const env = getGmailEnvVars(config);
          const gmail = await getGmailClient(env);
          const labelName = co === "USA" ? "forest-bills-done" : `forest-bills-${co.toLowerCase()}-done`;
          const labelId = await getOrCreateLabel(gmail, labelName);
          // Find recent labeled emails (last 7 days)
          const d = new Date(); d.setDate(d.getDate() - 7);
          const afterDate = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
          const q = `label:${labelName} after:${afterDate}`;
          const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 20 });
          const msgs = res.data.messages || [];
          let unlabeled = 0;
          for (const m of msgs) {
            try { await gmail.users.messages.modify({ userId: "me", id: m.id, requestBody: { removeLabelIds: [labelId] } }); unlabeled++; } catch {}
          }
          // Now do normal scan
          const r = await scanCompany(co);
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, company: r.company, unlabeled, count: r.count || 0, saved: r.saved, skipped: r.skipped, message: `[${r.company}] Unlabeled ${unlabeled} emails, found ${r.count||0}, saved ${r.saved} new` }) };
        } catch (e) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `Rescan failed: ${e.message}` }) };
        }
      }

      const r = await scanCompany(co);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, company: r.company, count: r.count || 0, saved: r.saved, skipped: r.skipped, message: `[${r.company}] ${r.count||0} found, ${r.saved} new, ${r.skipped} skipped` }) };
    }
    // Scan all
    const results = [];
    for (const k of getAllCompanyKeys()) {
      try {
        const r = await scanCompany(k);
        results.push({ company: r.company, count: r.count || 0, saved: r.saved, skipped: r.skipped, message: r.message });
      } catch (e) { results.push({ company: k, error: e.message }); }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, results, message: `Scanned ${results.length} companies` }) };
  } catch (err) { return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }; }
};
