const { google } = require("googleapis");
const { getStore } = require("@netlify/blobs");
const { getAllCompanyKeys, getCompanyConfig, getQBEnvVars } = require("./company-config");
const { getValidAccessToken } = require("./qb-auth");

const RECIPIENTS = [
  "elias@forestcol.com",
  "contabilidad@forestcol.com",
];

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token });
}

function blobKeyPending(co) { const k = (co||"USA").toUpperCase(); return k === "USA" ? "pending-invoices" : `${k.toLowerCase()}-pending-invoices`; }
function blobKeyLog(co) { const k = (co||"USA").toUpperCase(); return k === "USA" ? "bill-log" : `${k.toLowerCase()}-bill-log`; }

async function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2 });
}

async function getOverdueBills(config, companyKey) {
  const qb = getQBEnvVars(config);
  if (!qb.realmId || !qb.refreshToken) return [];
  try {
    const token = await getValidAccessToken(qb, companyKey);
    if (!token) return [];
    const base = `${qb.baseUrl}/v3/company/${qb.realmId}`;
    const today = new Date().toISOString().slice(0, 10);
    const query = `SELECT * FROM Bill WHERE DueDate < '${today}' AND Balance > '0' ORDERBY DueDate ASC MAXRESULTS 100`;
    const res = await fetch(`${base}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await res.json();
    const allBills = (data.QueryResponse?.Bill || []).map(b => ({
      vendor: b.VendorRef?.name || "Unknown",
      invoice: b.DocNumber || "—",
      due_date: b.DueDate,
      balance: b.Balance || 0,
      days_overdue: Math.floor((new Date() - new Date(b.DueDate)) / (1000*60*60*24)),
    }));

    // Filter to only tracked vendors (in vendorFilter)
    const vendorFilter = config.vendorFilter || [];
    return allBills.filter(b => {
      const lower = b.vendor.toLowerCase();
      return vendorFilter.some(v => lower.includes(v));
    });
  } catch (e) {
    console.warn(`Overdue check failed for ${config.entity}:`, e.message);
    return [];
  }
}

function buildEmailHTML(summaries) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const totalPending = summaries.reduce((s, c) => s + c.pending, 0);
  const totalNew = summaries.reduce((s, c) => s + c.newToday, 0);
  const totalOverdue = summaries.reduce((s, c) => s + c.overdue.length, 0);

  // Calculate overdue totals per company
  const overdueAmts = {};
  summaries.forEach(s => {
    overdueAmts[s.company] = s.overdue.reduce((sum, o) => sum + o.balance, 0);
  });
  const totalOverdueAmt = Object.values(overdueAmts).reduce((s, v) => s + v, 0);

  let html = `
<div style="font-family:'Montserrat',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#1b203d;color:#ffffff;border-radius:8px;overflow:hidden;">
  <div style="background:#13172e;padding:20px 24px;border-bottom:1px solid rgba(149,181,206,0.13);">
    <span style="font-size:14px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;">FOREST<span style="color:#e7e244;"> · </span>BILLS</span>
    <span style="float:right;font-size:11px;color:#8b90a8;">Daily Digest</span>
  </div>
  <div style="padding:24px;">
    <div style="font-size:13px;color:#8b90a8;margin-bottom:16px;">${today}</div>
    
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;background:#252b4a;border-radius:6px;padding:12px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8b90a8;">New Today</div>
        <div style="font-size:24px;font-weight:800;color:#e7e244;">${totalNew}</div>
      </div>
      <div style="flex:1;background:#252b4a;border-radius:6px;padding:12px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8b90a8;">Pending</div>
        <div style="font-size:24px;font-weight:800;color:#95b5ce;">${totalPending}</div>
      </div>
      <div style="flex:1;background:#252b4a;border-radius:6px;padding:12px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8b90a8;">Overdue Bills</div>
        <div style="font-size:24px;font-weight:800;color:${totalOverdue > 0 ? '#e05252' : '#4caf7d'};">${totalOverdue}</div>
      </div>
    </div>`;

  // Overdue totals per company (only if there are overdue)
  if (totalOverdue > 0) {
    const flags = { USA: "US", EU: "EU", AU: "AU" };
    const colors = { USA: "#1b203d", EU: "#e7e244", AU: "#95b5ce" };
    html += `
    <div style="display:flex;gap:12px;margin-bottom:20px;">`;
    summaries.forEach(s => {
      const amt = overdueAmts[s.company] || 0;
      html += `
      <div style="flex:1;background:#252b4a;border-radius:6px;padding:10px 14px;text-align:center;border-top:3px solid ${colors[s.company]};">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8b90a8;">${flags[s.company]} Overdue</div>
        <div style="font-size:18px;font-weight:800;color:${amt > 0 ? '#e05252' : '#4caf7d'};margin-top:4px;">${s.currency}${amt > 0 ? amt.toLocaleString('en-US', {minimumFractionDigits:2}) : '0'}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Per-company vendor breakdown
  const coFlags = { USA: "🇺🇸", EU: "🇪🇺", AU: "🇦🇺" };
  const coColors = { USA: "#1b203d", EU: "#e7e244", AU: "#95b5ce" };

  for (const s of summaries) {
    html += `
    <div style="background:#252b4a;border-radius:6px;padding:14px 18px;margin-bottom:12px;border-left:3px solid ${coColors[s.company]};">
      <div style="font-size:12px;font-weight:700;color:${coColors[s.company]};margin-bottom:8px;">${coFlags[s.company]} ${s.entity}</div>
      <div style="font-size:12px;color:#f0f2f8;">
        ${s.newToday > 0 ? `<span style="color:${coColors[s.company]};font-weight:700;">${s.newToday} new</span> invoice${s.newToday > 1 ? 's' : ''} found today · ` : ''}
        ${s.pending > 0 ? `<span style="font-weight:700;">${s.pending}</span> pending in queue · ` : ''}
        ${s.pending === 0 && s.newToday === 0 ? '<span style="color:#4caf7d;">All clear</span>' : ''}
      </div>`;

    if (s.overdue.length > 0) {
      // Group by vendor
      const byVendor = {};
      s.overdue.forEach(o => {
        if (!byVendor[o.vendor]) byVendor[o.vendor] = { bills: [], total: 0, over30: 0, over30Count: 0 };
        byVendor[o.vendor].bills.push(o);
        byVendor[o.vendor].total += o.balance;
        if (o.days_overdue > 30) { byVendor[o.vendor].over30 += o.balance; byVendor[o.vendor].over30Count++; }
      });

      const overdueTotal = s.overdue.reduce((sum, o) => sum + o.balance, 0);
      html += `
      <div style="margin-top:10px;padding:10px 14px;background:rgba(224,82,82,0.08);border-radius:6px;border:1px solid rgba(224,82,82,0.15);">
        <div style="font-size:10px;font-weight:700;color:#e05252;margin-bottom:8px;letter-spacing:0.05em;text-transform:uppercase;">${s.overdue.length} OVERDUE BILLS · ${s.currency}${overdueTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
        <table style="width:100%;border-collapse:collapse;">`;

      const sortedVendors = Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total);
      for (const [vendor, data] of sortedVendors) {
        const warning = data.over30 > 0 ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;font-size:8px;font-weight:700;background:rgba(224,82,82,0.2);color:#e05252;">${s.currency}${data.over30.toLocaleString('en-US',{minimumFractionDigits:2})} &gt; 30 days</span>` : '';
        html += `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:6px 0;font-size:12px;font-weight:600;color:#f0f2f8;">${vendor}${warning}</td>
            <td style="padding:6px 0;text-align:right;font-size:11px;color:#8b90a8;">${data.bills.length} bill${data.bills.length>1?'s':''}</td>
            <td style="padding:6px 0;text-align:right;font-size:13px;font-weight:700;color:#e05252;min-width:80px;">${s.currency}${data.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          </tr>`;
      }
      html += `</table></div>`;
    }
    html += `</div>`;
  }

  html += `
    <div style="text-align:center;margin-top:20px;">
      <a href="https://forest-bills.netlify.app" style="display:inline-block;padding:10px 24px;background:#e7e244;color:#1b203d;font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;text-decoration:none;border-radius:4px;">Open Forest Bills</a>
    </div>
  </div>
  <div style="padding:12px 24px;background:#13172e;text-align:center;font-size:10px;color:#8b90a8;">
    Forest Bills · Automated Invoice Processing · forest-bills.netlify.app
  </div>
</div>`;

  return html;
}

async function sendEmail(gmail, to, subject, htmlBody) {
  // Encode subject as MIME encoded-word for UTF-8 support
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const raw = [
    `From: Forest Bills <me>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  try {
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_REFRESH_TOKEN) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, message: "Gmail not configured" }) };
    }

    const store = getBlobStore();
    const summaries = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const co of getAllCompanyKeys()) {
      const config = getCompanyConfig(co);

      // Count pending invoices
      let pending = 0;
      try {
        const data = await store.get(blobKeyPending(co), { type: "json" }) || [];
        pending = data.filter(i => i.status === "pending").length;
      } catch {}

      // Count new invoices today
      let newToday = 0;
      try {
        const data = await store.get(blobKeyPending(co), { type: "json" }) || [];
        newToday = data.filter(i => i.scanned_at && i.scanned_at.startsWith(today)).length;
      } catch {}

      // Get overdue bills from QB
      const overdue = await getOverdueBills(config, co);

      summaries.push({
        company: co,
        entity: config.entity,
        currency: config.currency === "EUR" ? "€" : (config.currency === "AUD" ? "A$" : "$"),
        pending,
        newToday,
        overdue,
      });
    }

    // Only send if there's something to report
    const totalPending = summaries.reduce((s, c) => s + c.pending, 0);
    const totalNew = summaries.reduce((s, c) => s + c.newToday, 0);
    const totalOverdue = summaries.reduce((s, c) => s + c.overdue.length, 0);

    if (totalPending === 0 && totalNew === 0 && totalOverdue === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Nothing to report — no email sent" }) };
    }

    const gmail = await getGmailClient();
    const dateFormatted = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    const details = [totalNew > 0 ? `${totalNew} nuevas` : null, totalPending > 0 ? `${totalPending} pendientes` : null, totalOverdue > 0 ? `${totalOverdue} vencidas` : null].filter(Boolean).join(" | ");
    const subject = `Resumen diario (${dateFormatted}) Forest Bills - ${details}`;
    const htmlBody = buildEmailHTML(summaries);

    for (const recipient of RECIPIENTS) {
      try {
        await sendEmail(gmail, recipient, subject, htmlBody);
        console.log(`📧 Digest sent to ${recipient}`);
      } catch (e) {
        console.error(`Failed to send to ${recipient}:`, e.message);
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        message: `Digest sent to ${RECIPIENTS.length} recipients`,
        summary: { totalNew, totalPending, totalOverdue },
      }),
    };
  } catch (err) {
    console.error("email-digest error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
