const Anthropic = require("@anthropic-ai/sdk");
const { getStore } = require("@netlify/blobs");
const { getCompanyConfig, getQBEnvVars, normalizeVendor } = require("./company-config");
const { getVendorConfigs } = require("./vendor-config");

const Anthropic_client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { getValidAccessToken } = require("./qb-auth");

// ─── Document preparation ─────────────────────────────────────────────────────
// Some vendor download links serve the PDF with HTTP response headers glued in
// front of %PDF- (seen in production: 201 bytes of "date:/etag:/content-length"
// junk before the real file), and some "PDFs" are actually images renamed to
// .pdf. Claude's API rejects both with an opaque 400 ("The PDF specified was
// not valid"), so repair or adapt the payload here instead of failing.
const UPLOAD_ERRORS = {
  UPLOAD_EMPTY: "The uploaded file is empty or could not be decoded. Download the invoice again and retry.",
  UPLOAD_ENCRYPTED: "This PDF is password-protected. Open it in a PDF viewer, use Print → Save as PDF to make an unprotected copy, and upload that copy.",
  UPLOAD_NOT_PDF: "This file is not a readable PDF or image — it may be corrupted or an unsupported format. Download the invoice again from the vendor and retry.",
};

const IMAGE_MAGIC = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png",  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/gif",  bytes: [0x47, 0x49, 0x46, 0x38] },
];

function prepareDocument(b64) {
  let buf;
  try { buf = Buffer.from(b64 || "", "base64"); } catch { buf = Buffer.alloc(0); }
  if (!buf.length) throw new Error("UPLOAD_EMPTY");

  // PDF — possibly with junk prepended; the real header must appear early
  const idx = buf.indexOf("%PDF-");
  if (idx >= 0 && idx < 4096) {
    if (idx > 0) {
      console.warn(`prepareDocument: stripped ${idx} junk bytes before %PDF- header`);
      buf = buf.subarray(idx);
    }
    if (buf.includes("/Encrypt")) throw new Error("UPLOAD_ENCRYPTED");
    return { kind: "pdf", base64: idx > 0 ? buf.toString("base64") : b64, mediaType: "application/pdf" };
  }

  // Image renamed to .pdf (vendors export phone scans this way)
  const img = IMAGE_MAGIC.find(m => m.bytes.every((v, i) => buf[i] === v));
  const isWebp = buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
  if (img || isWebp) return { kind: "image", base64: b64, mediaType: img ? img.type : "image/webp" };

  throw new Error("UPLOAD_NOT_PDF");
}

// Claude content block for the prepared document (PDFs and images need different types)
function fileBlock(doc) {
  return doc.kind === "image"
    ? { type: "image", source: { type: "base64", media_type: doc.mediaType, data: doc.base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } };
}

// ─── QB Helpers ───────────────────────────────────────────────────────────────
async function findOrCreateVendor(name, token, realmId, baseUrl) {
  const base = `${baseUrl}/v3/company/${realmId}`;
  const q = `SELECT * FROM Vendor WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`;
  const s = await (await fetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })).json();
  if (s.QueryResponse?.Vendor?.length > 0) return s.QueryResponse.Vendor[0].Id;
  const c = await (await fetch(`${base}/vendor`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ DisplayName: name }) })).json();
  if (!c.Vendor?.Id) throw new Error(`QB vendor create failed for "${name}": ${c.Fault?.Error?.[0]?.Message || JSON.stringify(c).slice(0, 200)}`);
  return c.Vendor.Id;
}

async function getAccountRef(name, token, realmId, baseUrl) {
  const base = `${baseUrl}/v3/company/${realmId}`;
  const q = `SELECT * FROM Account WHERE FullyQualifiedName = '${name.replace(/'/g, "\\'")}'`;
  const d = await (await fetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })).json();
  const a = d.QueryResponse?.Account?.[0];
  return a ? { value: a.Id, name: a.Name } : null;
}

async function attachPDF(billId, pdfBase64, filename, token, realmId, baseUrl, mediaType = "application/pdf") {
  const base = `${baseUrl}/v3/company/${realmId}`;
  const boundary = `----FB${Date.now()}`;
  const meta = JSON.stringify({ AttachableRef: [{ EntityRef: { type: "Bill", value: String(billId) } }], ContentType: mediaType, FileName: filename || `bill-${billId}.pdf` });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${filename || "invoice.pdf"}"\r\nContent-Type: ${mediaType}\r\n\r\n`, "utf8"),
    Buffer.from(pdfBase64, "base64"),
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);
  const r = await fetch(`${base}/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
  const d = await r.json();
  if (d.Fault) console.warn("PDF attach warning:", JSON.stringify(d.Fault));
  return d;
}

async function checkDuplicate(invoiceNumber, vendorId, accessToken, realmId, baseUrl) {
  if (!invoiceNumber) return null;
  const base = `${baseUrl}/v3/company/${realmId}`;
  const query = `SELECT * FROM Bill WHERE DocNumber = '${invoiceNumber.replace(/'/g, "\\'")}'`;
  const res = await fetch(`${base}/query?query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const data = await res.json();
  const bills = data.QueryResponse?.Bill || [];
  return bills.find(b => b.VendorRef?.value === vendorId) || null;
}

async function createQBBill(extracted, doc, filename, token, qb, config, normalizedVendor) {
  const { realmId, baseUrl } = qb;
  const base = `${baseUrl}/v3/company/${realmId}`;

  const vendorId = await findOrCreateVendor(normalizedVendor, token, realmId, baseUrl);

  // If the bill already exists in QB (e.g. a previous push timed out after creating it),
  // return it as success so the frontend can mark the invoice done instead of erroring forever
  const existing = await checkDuplicate(extracted.invoice_number, vendorId, token, realmId, baseUrl);
  if (existing) return { billId: existing.Id, alreadyExisted: true };

  const lines = [];
  // Cache tax code lookups
  const taxCodeCache = {};
  async function getTaxCodeRef(taxCodeName) {
    if (!taxCodeName) return null;
    if (taxCodeCache[taxCodeName]) return taxCodeCache[taxCodeName];
    const q = `SELECT * FROM TaxCode WHERE Name = '${taxCodeName.replace(/'/g, "\\'")}'`;
    try {
      const d = await (await fetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })).json();
      const tc = d.QueryResponse?.TaxCode?.[0];
      if (tc) { taxCodeCache[taxCodeName] = { value: tc.Id }; return taxCodeCache[taxCodeName]; }
    } catch (e) { console.warn(`Tax code lookup failed for ${taxCodeName}:`, e.message); }
    return null;
  }

  for (const item of extracted.line_items) {
    const ref = await getAccountRef(item.account, token, realmId, baseUrl);
    if (!ref) { console.warn(`Account not found: ${item.account}`); continue; }
    const lineDetail = { AccountRef: ref };
    // Add tax code if present (AU invoices)
    if (item.tax_code) {
      const tcRef = await getTaxCodeRef(item.tax_code);
      if (tcRef) lineDetail.TaxCodeRef = tcRef;
    }
    lines.push({ Amount: item.amount, DetailType: "AccountBasedExpenseLineDetail", Description: item.description, AccountBasedExpenseLineDetail: lineDetail });
  }

  const billPayload = {
    VendorRef: { value: vendorId },
    TxnDate: extracted.invoice_date,
    DueDate: extracted.due_date,
    DocNumber: extracted.invoice_number,
    PrivateNote: `Auto-imported by Forest Bills (${config.entity}). ${extracted.notes || ""}`.trim(),
    Line: lines,
  };

  // If any line has a tax_code, set GlobalTaxCalculation to TaxExclusive
  // This tells QB the line amounts are EXCLUDING tax, and QB should calculate tax on top
  const hasTaxCodes = (extracted.line_items || []).some(i => i.tax_code);
  if (hasTaxCodes) {
    billPayload.GlobalTaxCalculation = "TaxExcluded";
  }

  // Determine currency: use hardcoded vendorCurrency map first, then Claude's extraction, then company default
  let billCurrency = extracted.currency || config.currency;
  if (config.vendorCurrency) {
    const vendorLower = (extracted.vendor_name || "").toLowerCase();
    for (const [key, cur] of Object.entries(config.vendorCurrency)) {
      if (vendorLower.includes(key)) { billCurrency = cur; break; }
    }
  }
  // Set CurrencyRef and ExchangeRate for foreign currency bills
  if (billCurrency && billCurrency !== config.currency) {
    billPayload.CurrencyRef = { value: billCurrency };
    // Fetch exchange rate from QB API
    try {
      const rateRes = await fetch(
        `${base}/exchangerate?sourcecurrencycode=${billCurrency}&asofdate=${extracted.invoice_date || new Date().toISOString().slice(0,10)}&minorversion=65`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      const rateData = await rateRes.json();
      if (rateData.ExchangeRate?.Rate) {
        billPayload.ExchangeRate = rateData.ExchangeRate.Rate;
        console.log(`[${config.entity}] Exchange rate ${billCurrency}→${config.currency}: ${rateData.ExchangeRate.Rate}`);
      } else {
        billPayload.ExchangeRate = 1;
        console.warn(`[${config.entity}] Could not fetch exchange rate, using 1`);
      }
    } catch (e) {
      billPayload.ExchangeRate = 1;
      console.warn(`[${config.entity}] Exchange rate fetch failed:`, e.message);
    }
  }

  const billRes = await fetch(`${base}/bill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(billPayload),
  });
  const billData = await billRes.json();
  if (!billData.Bill) throw new Error(`QB bill creation failed: ${JSON.stringify(billData.Fault || billData)}`);

  const billId = billData.Bill.Id;
  if (doc?.base64) { try { await attachPDF(billId, doc.base64, filename, token, realmId, baseUrl, doc.mediaType); } catch (e) { console.warn("PDF attach failed:", e.message); } }
  return { billId, alreadyExisted: false };
}

// The app can push a user-reviewed extraction (e.g. corrected QB accounts)
// instead of re-extracting: what the user approved is exactly what gets pushed
function isValidOverride(o) {
  return !!(o && typeof o === "object" && o.vendor_name && Array.isArray(o.line_items) &&
    o.line_items.some(l => l && l.account && Number(l.amount) > 0));
}
function sanitizeOverride(o) {
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));
  return {
    vendor_name: str(o.vendor_name, 200),
    invoice_number: str(o.invoice_number, 60),
    invoice_date: str(o.invoice_date, 20),
    due_date: str(o.due_date, 20),
    payment_terms: str(o.payment_terms, 60),
    total_amount: num(o.total_amount) || 0,
    currency: str(o.currency, 6),
    exchange_rate: num(o.exchange_rate),
    notes: str(o.notes, 500) || "",
    line_items: (o.line_items || []).slice(0, 50).map(l => ({
      account: str(l?.account, 200),
      description: str(l?.description, 300) || "",
      amount: num(l?.amount) || 0,
      confidence: str(l?.confidence, 10) || "high",
      ...(l?.tax_code ? { tax_code: str(l.tax_code, 30) } : {}),
    })).filter(l => l.account && l.amount > 0),
  };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const { pdf_base64, filename, mode, company, extract_only, vendor_hint, extracted_override } = JSON.parse(event.body);
    if (!pdf_base64) return { statusCode: 400, headers, body: JSON.stringify({ error: "No PDF provided" }) };

    const config = getCompanyConfig(company);
    const qb = getQBEnvVars(config);

    // Repair/classify the upload before anything touches it (junk-prefixed PDFs,
    // images renamed .pdf, encrypted or corrupted files get clear errors here)
    let doc;
    try { doc = prepareDocument(pdf_base64); }
    catch (e) {
      const friendly = UPLOAD_ERRORS[e.message];
      if (friendly) return { statusCode: 400, headers, body: JSON.stringify({ error: friendly, filename }) };
      throw e;
    }

    // Statement extraction mode — different prompt, no QB push
    if (mode === "statement") {
      const stmtPrompt = `You are an expert accounting assistant. Extract structured data from this vendor STATEMENT (not invoice).
A statement lists multiple invoices, payments, credits, and a running or total balance.

Extract:
- vendor_name: The vendor/supplier name
- period: The statement period (e.g. "Mar 1 – Mar 31, 2026")
- invoices: Array of each invoice/charge line with:
  - invoice_number: The invoice/reference number
  - date: Date in YYYY-MM-DD format
  - amount: The invoice amount as a positive number
  - type: "invoice", "credit", or "payment"
- total_balance: The total balance due shown on the statement
- currency: The currency code (USD, EUR, GBP, AUD)

RULES:
- Convert all dates to YYYY-MM-DD format.
- All amounts as positive numbers with dot decimal.
- Include ONLY invoice/charge lines, not payment lines (unless they are credits).
- If a line is a payment or credit, still include it but mark type accordingly.

Return ONLY valid JSON:
{"vendor_name":"","period":"","invoices":[{"invoice_number":"","date":"YYYY-MM-DD","amount":0,"type":"invoice"}],"total_balance":0,"currency":"${config.currency}"}`;

      const stmtResponse = await Anthropic_client.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 4000, system: stmtPrompt + "\n\nIMPORTANT: After your analysis, output ONLY a single JSON object. Do not include any text outside the JSON.",
        messages: [{ role: "user", content: [
          fileBlock(doc),
          { type: "text", text: "Extract all invoice lines from this statement. Output a single JSON object with the result." },
        ] }],
      });

      let stmtExtracted;
      try {
        let raw = stmtResponse.content[0].text;
        raw = raw.replace(/```json|```/g, "").trim();
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) raw = raw.slice(jsonStart, jsonEnd + 1);
        stmtExtracted = JSON.parse(raw);
      }
      catch { throw new Error(`Invalid JSON from statement extraction: ${stmtResponse.content[0].text.slice(0, 200)}`); }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, extracted: stmtExtracted, filename, company: company || "USA" }) };
    }

    // Invoice extraction — skipped when the app sends a user-reviewed extraction
    // (extracted_override): the user may have corrected QB accounts in the queue,
    // so on confirm we push exactly what they approved (also saves a Claude call)
    let extracted;
    if (mode === "confirm" && isValidOverride(extracted_override)) {
      extracted = sanitizeOverride(extracted_override);
    } else {
    // Invoice extraction with company-specific prompt
    const response = await Anthropic_client.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 2500, system: config.extractionPrompt + "\n\nIMPORTANT: Output ONLY a single JSON object. Be concise — combine similar line items. No analysis text outside the JSON.",
      messages: [{ role: "user", content: [
        fileBlock(doc),
        { type: "text", text: "Extract invoice data. Output JSON only, no other text." },
      ] }],
    });

    try {
      let raw = response.content[0].text;
      raw = raw.replace(/```json|```/g, "").trim();
      // Extract JSON object from response (skip any reasoning text before/after)
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) raw = raw.slice(jsonStart, jsonEnd + 1);
      extracted = JSON.parse(raw);
    }
    catch { throw new Error(`Invalid JSON from Claude: ${response.content[0].text.slice(0, 200)}`); }
    }

    // Override vendor name if vendor_hint provided (manual upload with vendor selection)
    if (vendor_hint) extracted.vendor_name = vendor_hint;

    if (mode === "preview" || extract_only) return { statusCode: 200, headers, body: JSON.stringify({ success: true, extracted, filename, company: company || "USA" }) };

    // Push to QB
    if (!qb.realmId) throw new Error(`QB_REALM_ID missing for ${config.entity}`);
    const token = await getValidAccessToken(qb, company);

    // Normalize vendor name (hardcoded + dynamic configs)
    let normalizedVendor = normalizeVendor(extracted.vendor_name, config);
    try {
      const dynamicVendors = await getVendorConfigs(company || "USA");
      for (const dv of dynamicVendors.filter(v => v.active)) {
        const lower = (extracted.vendor_name || '').toLowerCase();
        if (lower.includes(dv.qb_name.toLowerCase()) || dv.qb_name.toLowerCase().includes(lower)) {
          normalizedVendor = dv.qb_name; break;
        }
      }
    } catch(e) {}

    const { billId, alreadyExisted } = await createQBBill(extracted, doc, filename, token, qb, config, normalizedVendor);
    const qb_url = `https://app.qbo.intuit.com/app/bill?txnId=${billId}`;

    // Persist to blob log
    try {
      const siteID = process.env.NETLIFY_SITE_ID;
      const blobToken = process.env.NETLIFY_AUTH_TOKEN;
      if (siteID && blobToken) {
        const store = getStore({ name: "forest-bills", siteID, token: blobToken, consistency: "strong" });
        const blobKey = (company || "USA").toUpperCase() === "USA" ? "bill-log" : `${(company || "usa").toLowerCase()}-bill-log`;
        let log = [];
        try { log = await store.get(blobKey, { type: "json" }) || []; } catch(e) {}
        if (!log.find(b => b.invoice_number === extracted.invoice_number && b.vendor === extracted.vendor_name)) {
          log.unshift({
            invoice_number: extracted.invoice_number, vendor: extracted.vendor_name,
            invoice_date: extracted.invoice_date, due_date: extracted.due_date,
            total_amount: extracted.total_amount, currency: extracted.currency || config.currency,
            line_items: extracted.line_items, bill_id: billId, qb_url,
            company: company || "USA", saved_at: new Date().toISOString(),
          });
          await store.setJSON(blobKey, log);
        }
      }
    } catch(e) { console.warn("Log persist failed:", e.message); }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, bill_id: billId, already_existed: alreadyExisted, extracted, normalized_vendor: normalizedVendor, filename, qb_url, company: company || "USA" }) };
  } catch (err) {
    console.error("process-bill error:", err);
    // Anthropic rejects unreadable documents with an opaque 400; surface it as
    // a user-fixable problem rather than a generic server error
    if (/PDF specified was not valid|could not process (the )?(pdf|image|document)/i.test(err.message || "")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "The AI could not read this file as a PDF. It may be corrupted — open it on your computer to verify, or re-download it from the vendor and upload again." }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
