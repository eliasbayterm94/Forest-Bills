// ─── FOREST BILLS — MULTI-COMPANY CONFIGURATION ──────────────────────────────
// Each company has its own QB credentials (via env var prefix), vendor whitelist,
// vendor aliases, and Chart of Accounts mapping for Claude extraction.

const COMPANIES = {

  // ━━━ USA — Forest Coffee LLC (Orlando, FL) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  USA: {
    entity: "Forest Coffee LLC",
    currency: "USD",
    flag: "🇺🇸",
    qbEnvPrefix: "",
    qbBaseUrl: "https://quickbooks.api.intuit.com",

    vendorEmails: [
      "invoiceshou@dupuygroup.com",
      "samples@continentalterminals.com",
      "invoice@annextryco.net",
      "jessica@continentalterminals.com",
      "ana@continentalterminals.com",
      "dougjr@continentalterminals.com",
      "maria.duarte@shippgl.com",
      "gayle.cepeda@shippgl.com",
      "accounting@gbhdepot.com",
      "john.hayden@vamcorp.ca",
      "kacosta@rpmwarehouse.com",
      "ar@centurytransportation.net",
    ],

    vendorAliases: {
      "continental terminals, inc.":      "Continental Terminals Inc",
      "continental terminals, inc":       "Continental Terminals Inc",
      "continental terminals inc.":       "Continental Terminals Inc",
      "continental terminals inc, ca":    "Continental Annex",
      "continental terminals inc., ca":   "Continental Annex",
      "continental terminals inc.,ca":    "Continental Annex",
      "continental terminals inc,ca":     "Continental Annex",
      "continental terminals ca":         "Continental Annex",
      "continental terminals":            "Continental Terminals Inc",
      "continental terminals annex inc.": "Continental Annex",
      "continental terminals annex inc":  "Continental Annex",
      "continental terminals annex":      "Continental Annex",
      "annex consolidation center":       "Continental Annex",
      "dupuy storage houston, llc":       "Dupuy Storage Houston",
      "dupuy storage houston llc":        "Dupuy Storage Houston",
      "dupuy group":                      "Dupuy Storage Houston",
      "perimeter international":          "PGL",
      "perimeter global logistics":       "PGL",
      "century transportation, inc.":     "Century Transportation Inc",
      "century transportation, inc":      "Century Transportation Inc",
      "century transportation inc.":      "Century Transportation Inc",
      "century transportation inc":       "Century Transportation Inc",
      "century transportation":           "Century Transportation Inc",
      "csa transportation, inc.":         "Century Transportation Inc",
      "csa transportation":               "Century Transportation Inc",
      "gbh depot inc.":                   "GBH DEPOT INC",
      "gbh depot, inc.":                  "GBH DEPOT INC",
      "gbh depot inc":                    "GBH DEPOT INC",
      "gbh depot":                        "GBH DEPOT INC",
      "vamcorp":                          "GBH DEPOT INC",
      "echo global logistics, inc.":      "Echo Global Logistics Inc",
      "echo global logistics inc.":       "Echo Global Logistics Inc",
      "echo global logistics":            "Echo Global Logistics Inc",
      "the green room inc.":              "The Green Room Inc",
      "the green room, inc.":             "The Green Room Inc",
    },

    vendorFilter: [
      "continental terminals", "gbh depot", "dupuy storage", "continental annex",
      "annex", "century transportation", "pgl", "perimeter global",
      "perimeter international", "echo global logistics", "the green room",
    ],

    extractionPrompt: `You are an expert accounting assistant for Forest Coffee LLC, a green coffee importer.
Extract structured data from supplier invoices and map each line item to the correct QuickBooks account.

VENDOR RULES:
1. CONTINENTAL TERMINALS NJ (200 Middlesex Ave, Carteret NJ):
   - Standard delivery: ALL lines → "handling" (Loading, Pallet, Shrinkwrap, Strap, Pick-out, Min loading)
   - Inbound (comment says "Inbound"): Pro-Rate Storage → "storage", Unloading/Strip/Sorting → "container"

2. CONTINENTAL TERMINALS CA/ANNEX (California locations, also "Continental Terminals Inc, CA"):
   - STORAGE INVOICES (title says "STORAGE INVOICE", service is "Recurring Storage"): ALL lines → "storage". The invoice total at the bottom of the last page is the amount. Each line is a cargo lot with individual storage charges — sum ALL of them or use the Invoice Total shown at the bottom.
   - Inbound: Pro-Rate Storage → "storage", Drayage/Chassis/Gate/Wait/Transit/Unloading/Strip/Sort → "container"
   - Outbound: Min Loading/Pallet/Strap/Card/Wrap → "handling", Sampling/UPS → "samples"

3. DUPUY STORAGE HOUSTON (7703 Cannon St, Houston TX):
   - Initial Storage Prorated → "storage"
   - Palletizing/Grocery Order Pallet/Load Min/Loose/Wrapping/Strapping → "handling"
   - Unload GrainPro MultiLot → "container"

4. PGL / PERIMETER: ALL lines → "container" (no exceptions)
5. CENTURY TRANSPORTATION: ALL lines → "container"

6. GBH DEPOT INC (1310 Gerard Cadieux, Valleyfield QC, Canada):
   - Storage → "storage"
   - Coffee Handling Inbound, Container Handling, Drayage, FSC Inbound, Surcharge, Weighing → "container"
   - Administrative, Fees → "handling" (combine into one line)
   - Coffee Handling, Coffee Handling Outbound, Packaging → "handling" (combine into one line)
   Note: For GBH, group lines by account and combine. Result should be max 3 lines: Storage + Container + Handling.

ACCOUNTS: storage="Storage", handling="Shipping, Freight & Delivery:Handling & Loadout",
container="Shipping, Freight & Delivery:Container costs", samples="Shipping, Freight & Delivery:Samples request",
duties="Shipping, Freight & Delivery:Duties", other="Other Business Expenses"

RULES: Combine same-account lines. Dates YYYY-MM-DD. Net30=+30d, Net15=+15d.
Return ONLY valid JSON:
{"vendor_name":"","vendor_address":"","invoice_number":"","invoice_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","payment_terms":"","total_amount":0,"currency":"USD","line_items":[{"account":"","description":"","amount":0,"confidence":"high|medium|low"}],"overall_confidence":"high|medium|low","notes":""}`,
  },

  // ━━━ EU — Forest Coffee SL (Madrid, Spain) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EU: {
    entity: "Forest Coffee SL",
    currency: "EUR",
    flag: "🇪🇺",
    qbEnvPrefix: "EU_",
    qbBaseUrl: "https://quickbooks.api.intuit.com",

    vendorEmails: [
      "finrtm@vollers.com",
      "findon@vollers.com",
      "notification@nl01.inxpress-mail.com",
      "daniela.stefan@mainfreight.com",
      "sorin.panait@mainfreight.com",
      "noreply-crossfireeu@mainfreight.com",
      "alexr@agcs.uk.com",
      "ackie@agcs.uk.com",
      "davidm@agcs.uk.com",
      "e-invoicing.sk@raben-group.com",
    ],

    vendorAliases: {
      "vollers holland b.v.":                 "VOLLERS HOLLAND B.V.",
      "vollers holland bv":                   "VOLLERS HOLLAND B.V.",
      "vollers holland":                      "VOLLERS HOLLAND B.V.",
      "vollers dongen":                       "VOLLERS HOLLAND B.V.",
      "vollers":                              "VOLLERS HOLLAND B.V.",
      "agc (commodity store) ltd.":           "AGC (Commodity Store) Ltd.",
      "agc (commodity store) ltd":            "AGC (Commodity Store) Ltd.",
      "agc commodity store ltd":              "AGC (Commodity Store) Ltd.",
      "agc commodity store":                  "AGC (Commodity Store) Ltd.",
      "agcs":                                 "AGC (Commodity Store) Ltd.",
      "raben logistics slovakia, s.r.o.":     "Raben Logistics Slovakia SRO",
      "raben logistics slovakia s.r.o.":      "Raben Logistics Slovakia SRO",
      "raben logistics slovakia":             "Raben Logistics Slovakia SRO",
      "raben logistics":                      "Raben Logistics Slovakia SRO",
      "raben":                                "Raben Logistics Slovakia SRO",
      "inxpress nederland":                   "InXpress Nederland",
      "inxpress":                             "InXpress Nederland",
      "mainfreight s.r.l.":                   "Mainfreight S.R.L.",
      "mainfreight s.r.l":                    "Mainfreight S.R.L.",
      "mainfreight srl":                      "Mainfreight S.R.L.",
      "mainfreight":                          "Mainfreight S.R.L.",
    },

    vendorFilter: [
      "vollers", "agc", "commodity store", "raben", "inxpress", "mainfreight",
    ],

    // Hardcoded vendor currencies — overrides whatever Claude extracts
    vendorCurrency: {
      "agc": "GBP",
      "commodity store": "GBP",
    },

    extractionPrompt: `You are an expert accounting assistant for Forest Coffee SL, a specialty green coffee exporter operating in Europe.
Extract structured data from supplier invoices and map each line item to the correct QuickBooks account.

CRITICAL: European invoices use DD.MM.YYYY or DD/MM/YYYY date format. Convert ALL dates to YYYY-MM-DD.
European number format uses comma as decimal separator (e.g. 1.584,44 = 1584.44). Convert to standard decimals.
Currency may be EUR or GBP. Detect from the invoice.

VENDOR RULES:

1. VOLLERS HOLLAND B.V. (Sardiniëweg 4, Amsterdam):
   Vollers sends DIFFERENT invoice types — identify by Remark or line item descriptions:
   
   a) OUTBOUND ORDERS (Remark: "Outbound orders"):
      These invoices can have 50-90+ individual line items across multiple pages.
      DO NOT analyze each line individually. Instead:
      1. Find the TOTAL on the last page (e.g. "Total incl. VAT EUR 2.140,25")
      2. Scan line descriptions to identify amounts per category:
         - "Shipping and delivery expense:Handling & Loadout": Palletising, Loading truck, Handling-Bag fee, Pallets/One way pallets, Toeslag (surcharge)
         - "Clearance": VAT-administration, Export declaration, T2LF document
         - "Shipping and delivery expense": Transport lines (with route like "Dongen-Amsterdam")
         - "Shipping and delivery expense:Container Carry out cost": Fuel surcharge
      3. Sum each category and output ONLY 2-4 combined line items (one per category).
      The sum of all line items MUST equal the invoice total.
   
   b) WAREHOUSE RENT (all lines are "Warehouse rent raw coffee"):
      - ALL lines → "Storage"
   
   c) IMPORT CONTAINER (Remark: "Import" or lines contain "Unloading container"):
      - Unloading container (Bags, Bags<50, Crt) → "Shipping and delivery expense:Container Carry out cost"
      - Import declaration, Import administration fee, Additional item(s) on customs → "Clearance"
      - Warehouse rent lines (partial month) → "Storage"
      - Transport → "Shipping and delivery expense"
      - Fuel surcharge → "Shipping and delivery expense:Container Carry out cost"
   
   d) PREPAID (Subject: "Prepaid to:" — THC, naviera charges):
      - ALL lines → "Shipping and delivery expense:Container Carry out cost"
   
   e) SAMPLES (Remark: "Sample orders"):
      - Sampling + Courrier costs → "Shipping and delivery expense:Samples request"

2. AGC (COMMODITY STORE) LTD (Unit 11 Eurocourt, West Thurrock, Essex):
   ALL invoices in GBP. Set currency to "GBP" for ALL AGC invoices.
   
   a) RECEIVING & HANDLING ("Charges for receiving and handling" + "Agency & Attention"):
      - ALL lines → "Shipping and delivery expense:Container Carry out cost"
   
   b) CUSTOMS CLEARANCE ("customs clearance"):
      - ALL lines → "Shipping and delivery expense:Container Carry out cost"
   
   c) HAULAGE / DELIVERIES ("PALLET INVOICE" or "Delivery EURO"):
      - Delivery lines + AGC Pallet Charge → "Shipping and delivery expense GBP"
   
   d) WAREHOUSE RENT ("warehouse rent on goods held"):
      - ALL lines → "Storage GBP"

3. RABEN LOGISTICS SLOVAKIA S.R.O.:
   - SPOT import / SPOT transit → "Shipping and delivery expense"

4. INXPRESS NEDERLAND:
   - ALL lines → "Shipping and delivery expense"

5. MAINFREIGHT S.R.L. (Ploiesti, Romania, C.I.F. RO2698644):
   - Freight charges → "Shipping and delivery expense"
   - ALL invoices are in EUR. Use the EUR amount, NOT the RON amount.
   - Invoice number format: 7126006034, 7127000256, etc.
   - Payment terms: 7 days from invoice date.

RULES:
- Combine same-account lines into a single line item.
- For multi-type invoices (e.g. Vollers Import), SPLIT into separate line items per account.
- Dates must be YYYY-MM-DD format (convert from European DD.MM.YYYY or DD/MM/YYYY).
- All amounts as numbers with dot decimal (convert from European comma decimal).
- Detect payment terms: "14 DAYS" → Net14, "30 DAY NET MONTHLY" → Net30.
- If due_date equals invoice_date, note "immediate payment" in notes.

Return ONLY valid JSON:
{"vendor_name":"","vendor_address":"","invoice_number":"","invoice_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","payment_terms":"","total_amount":0,"currency":"EUR","exchange_rate":null,"line_items":[{"account":"","description":"","amount":0,"confidence":"high|medium|low"}],"overall_confidence":"high|medium|low","notes":""}

IMPORTANT: For GBP invoices, set currency to "GBP". The exchange_rate field is the GBP to EUR rate (e.g. 1.17 means 1 GBP = 1.17 EUR). If the invoice does not state an exchange rate, set exchange_rate to null and the system will use 1 as default.`,
  },

  // ━━━ AU — Forest Coffee AU Pty Ltd (Unley, SA) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AU: {
    entity: "Forest Coffee AU Pty Ltd",
    currency: "AUD",
    flag: "🇦🇺",
    qbEnvPrefix: "AU_",
    qbBaseUrl: "https://quickbooks.api.intuit.com",

    vendorEmails: [
      "cargowise@rpmfreight.com.au",
      "erica@maptrans.com.au",
      "admin@maptrans.com.au",
      "invoices@apps.myob.com",
      "mfd.statements@mainfreight.com.au",
    ],

    vendorAliases: {
      "rpm freight & logistics melbourne p/l":  "RPM Freeight & Logistics Melbourne P/L",
      "rpm freight & logistics melbourne":      "RPM Freeight & Logistics Melbourne P/L",
      "rpm freight melbourne":                  "RPM Freeight & Logistics Melbourne P/L",
      "rpm freight & logistics derrimut":        "RPM Freeight & Logistics Melbourne P/L",
      "maptrans":                               "MRP FREIGHT PTY LTD",
      "mrp freight pty ltd":                    "MRP FREIGHT PTY LTD",
      "mrp freight":                            "MRP FREIGHT PTY LTD",
      "rpm freight & logistics pty ltd":        "MRP FREIGHT PTY LTD",
      "rpm freight & logistics":                "MRP FREIGHT PTY LTD",
      "rpm freight pty ltd":                    "MRP FREIGHT PTY LTD",
      "mainfreight distribution pty ltd.":      "Mainfreight Distribution Pty Ltd.",
      "mainfreight distribution pty ltd":       "Mainfreight Distribution Pty Ltd.",
      "mainfreight distribution":               "Mainfreight Distribution Pty Ltd.",
      "mainfreight":                            "Mainfreight Distribution Pty Ltd.",
    },

    vendorFilter: [
      "rpm freight", "rpm", "mrp freight", "mrp", "maptrans", "mainfreight",
    ],

    extractionPrompt: `You are an expert accounting assistant for Forest Coffee AU Pty Ltd, a specialty green coffee importer in Australia.
Extract structured data from supplier invoices and map each line item to the correct QuickBooks account.

CRITICAL: Australian invoices use DD/MM/YYYY date format. Convert ALL dates to YYYY-MM-DD.
Currency is ALWAYS AUD.

IMPORTANT GST HANDLING:
Australian invoices include GST (Goods and Services Tax at 10%). You MUST:
- Use the EXCLUDING GST amount (Excl Amt) for each line item, NOT the inc GST amount.
- For each line item, include a "tax_code" field indicating the GST treatment.
- The total_amount in the JSON should be the TOTAL INCLUDING GST from the invoice.

Tax code mapping from invoice to QuickBooks:
- Lines showing "10%=XX.XX" or with a GST amount → tax_code: "GST on purchases"
- Lines showing "Zero Rated" → tax_code: "GST free purchases"  
- Lines showing "Exempt Rated" → tax_code: "Out of Scope"
- If no GST info shown, default to → tax_code: "GST on purchases"

VENDOR RULES:

1. RPM FREIGHT & LOGISTICS MELBOURNE P/L (18 Derrimut Drive, Derrimut VIC):
   Weekly consolidated invoices with multiple service groups. SPLIT by type.
   CRITICAL: ALL RPM lines have 10% GST. Set tax_code: "GST on purchases" for EVERY line.
   The invoice shows columns: Excl Amt | GST | Incl Amt. ALWAYS use the "Excl Amt" column.
   
   a) DELIVERY ORDERS (ref starts with "D.O. No:" or "DO No."):
      Service codes: MELPLT-OUT, MELORDERPIC, MELWRAP, MELBAG-OUT, MEL35KGBAG, MELSTRAP,
      MELLABELLIN, MELSAMEDAYO, MELSMLPLAIN + delivery (MELVPT, MEL-SYD, MEL-INTERST, MEL-MELB)
      → account: "Shipping, Freight, and Delivery Postage & Handling"
      Use the "Excl Amt" column for amount.
   
   b) STORAGE (ref is "STG"):
      Service codes: MELSTG, MELCHEPHIRE
      → account: "Shipping, Freight, and Delivery Postage & Handling:Storage"
      Use the "Excl Amt" column for amount.
   
   c) SAMPLES REQUEST (ref contains "SAMPLES REQUEST"):
      Service codes: MELHND-SAMP, MELSAMPLE, MELPOSTSAMP
      → account: "Shipping, Freight, and Delivery Postage & Handling"
      Add "(Samples)" to description so it's identifiable.
      Use the "Excl Amt" column for amount.
   
   d) CONTAINER UNPACK (ref is a container number like TEMU, MRKU, TLLU, etc. with UNPACK services):
      Service codes: MELUNPACK1, MELPLT-IN, MELWRAP (inbound), MELLABELLIN (inbound), MELAQIS
      → account: "Shipping, Freight, and Delivery Postage & Handling:Container import expenses"
      Use the "Excl Amt" column for amount.
   
   e) CONTAINER TRANSPORT/PORT FEES (ref is container number with transport services):
      Service codes: MEL20GP, MELSLOTS, MELINFRASTR, MELFCL-TOLL, MEL-DPW-COR, MEL-DPW-ENE
      → account: "Shipping, Freight, and Delivery Postage & Handling:Container import expenses"
      Use the "Excl Amt" column for amount.
   
   RPM invoices show: Total Excl GST, GST, Total Inc GST at the bottom.
   Set total_amount = Total Inc GST. Line item amounts = Excl Amt per group.

2. MAPTRANS / MRP FREIGHT PTY LTD (PO Box 7232, Alexandria NSW, ABN 99 169 703 753):
   CRITICAL VENDOR IDENTIFICATION: Maptrans invoices have "Maptrans" logo at the top and ABN 99 169 703 753.
   They also say "RPM FREIGHT & LOGISTICS PTY LTD" in the payment/remittance section — IGNORE THAT for vendor name.
   The vendor_name MUST be "Maptrans" (not RPM). The system will normalize it to "MRP FREIGHT PTY LTD" in QB.
   
   Import customs clearance invoices per container shipment.
   ALL lines → account: "Shipping, Freight, and Delivery Postage & Handling:Container import expenses"
   
   CRITICAL: Each line has its own GST treatment. Map EACH line individually:
   - "Customs Disbursement Charges" (Exempt Rated) → tax_code: "Out of Scope", amount from CHARGES column
   - "Quarantine Entry Fee" (Zero Rated) → tax_code: "GST free purchases", amount from CHARGES column
   - "Import Customs Clearance Fee" (10%=XX.XX) → tax_code: "GST on purchases", amount from CHARGES column
   - "Quarantine Attendance" (10%=XX.XX) → tax_code: "GST on purchases", amount from CHARGES column
   - "Delivery Order Fee" (Zero Rated) → tax_code: "GST free purchases", amount from CHARGES column
   - "Custom Complience Fee" (10%=XX.XX) → tax_code: "GST on purchases", amount from CHARGES column
   - "Additional Quarantine Fee" (Zero Rated) → tax_code: "GST free purchases", amount from CHARGES column
   
   DO NOT combine lines — keep each line separate with its own tax_code.
   Set total_amount = TOTAL AUD (inc GST) from invoice.

3. MAINFREIGHT DISTRIBUTION PTY LTD (107 Gateway Boulevard, Epping VIC):
   Weekly TAX INVOICE / STATEMENT. 
   Look for "Total AUD (inc GST)" — this is the current week charge.
   If current charges are $0.00 and only "Outstanding" shows, this is just a statement reminder — 
   note "Statement only - no new charges" and set total_amount to the Outstanding amount.
   → account: "Shipping, Freight, and Delivery Postage & Handling"
   The amounts shown are INCLUSIVE of GST.

RULES:
- For RPM: COMBINE all lines that share the same account AND same tax_code into ONE line item.
  Example: if there are 5 D.O. lines all going to "Shipping, Freight, and Delivery Postage & Handling" with tax_code "GST on purchases",
  combine them into 1 line with the sum of all Excl Amt values and a description listing the D.O. numbers.
  Storage lines get combined separately since they go to a different account.
  Result: a typical RPM invoice should produce 2-4 lines max (handling, storage, samples, container), NOT one per D.O.
- For Maptrans: COMBINE lines that share the same tax_code into one line per tax_code.
  Example: "Import Customs Clearance Fee" (10%) + "Quarantine Attendance" (10%) + "Custom Compliance Fee" (10%) → 1 line with tax_code "GST on purchases".
  "Quarantine Entry Fee" (Zero) + "Delivery Order Fee" (Zero) → 1 line with tax_code "GST free purchases".
  "Customs Disbursement Charges" (Exempt) → 1 line with tax_code "Out of Scope".
  Result: a typical Maptrans invoice should produce 2-3 lines max (one per tax_code group).
- For Mainfreight: Single line per invoice.
- Dates must be YYYY-MM-DD (convert from DD/MM/YYYY or DD-Mon-YY).
- Payment terms: "Net 30" → +30 days, "7 Days" → +7 days.
- All amounts as numbers with dot decimal.

Return ONLY valid JSON:
{"vendor_name":"","vendor_address":"","invoice_number":"","invoice_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","payment_terms":"","total_amount":0,"currency":"AUD","line_items":[{"account":"","description":"","amount":0,"tax_code":"GST on purchases|GST free purchases|Out of Scope","confidence":"high|medium|low"}],"overall_confidence":"high|medium|low","notes":""}`,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCompanyConfig(key) {
  const k = (key || "USA").toUpperCase();
  if (!COMPANIES[k]) throw new Error(`Unknown company: ${k}. Valid: ${Object.keys(COMPANIES).join(", ")}`);
  return COMPANIES[k];
}

function getQBEnvVars(config) {
  const p = config.qbEnvPrefix;
  return {
    clientId:     process.env[`${p}QB_CLIENT_ID`]     || process.env.QB_CLIENT_ID,
    clientSecret: process.env[`${p}QB_CLIENT_SECRET`] || process.env.QB_CLIENT_SECRET,
    refreshToken: process.env[`${p}QB_REFRESH_TOKEN`] || process.env.QB_REFRESH_TOKEN,
    realmId:      process.env[`${p}QB_REALM_ID`]      || process.env.QB_REALM_ID,
    baseUrl:      config.qbBaseUrl,
  };
}

function getGmailEnvVars(config) {
  const p = config.qbEnvPrefix;
  return {
    clientId:     process.env[`${p}GMAIL_CLIENT_ID`]     || process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env[`${p}GMAIL_CLIENT_SECRET`] || process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env[`${p}GMAIL_REFRESH_TOKEN`] || process.env.GMAIL_REFRESH_TOKEN,
    startDate:    process.env[`${p}GMAIL_START_DATE`]    || process.env.GMAIL_START_DATE,
  };
}

function normalizeVendor(name, config) {
  if (!name) return name;
  const aliases = config.vendorAliases || {};
  const lower = name.trim().toLowerCase();
  // Exact match first
  if (aliases[lower]) return aliases[lower];
  // Sort aliases by length (longest first) to match most specific alias
  const sorted = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonical] of sorted) {
    if (lower.includes(alias) || alias.includes(lower)) return canonical;
  }
  return name.trim().replace(/,?\s*(inc\.|inc|llc\.?|ltd\.?|b\.v\.?|bv|s\.l\.?|sl|s\.r\.o\.?|pty)$/i, "").trim();
}

function matchesVendorFilter(name, config) {
  const lower = (name || "").toLowerCase();
  return (config.vendorFilter || []).some(v => lower.includes(v));
}

function getBlobKey(base, companyKey) {
  const k = (companyKey || "USA").toUpperCase();
  return k === "USA" ? base : `${k.toLowerCase()}-${base}`;
}

function getAllCompanyKeys() { return Object.keys(COMPANIES); }

function getCompanyList() {
  return Object.entries(COMPANIES).map(([key, cfg]) => ({
    key, entity: cfg.entity, currency: cfg.currency, flag: cfg.flag,
    hasVendors: cfg.vendorEmails.length > 0,
  }));
}

module.exports = {
  COMPANIES, getCompanyConfig, getQBEnvVars, getGmailEnvVars,
  normalizeVendor, matchesVendorFilter, getBlobKey, getAllCompanyKeys, getCompanyList,
};
