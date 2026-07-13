// ─── FOREST BILLS — VENDOR CONFIG CRUD ────────────────────────────────────────
// Manages dynamic vendor configurations stored in Netlify Blobs.
// These supplement (not replace) the hardcoded vendors in company-config.js.

const { getStore } = require("@netlify/blobs");

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not set");
  return getStore({ name: "forest-bills", siteID, token });
}

function vendorsBlobKey(company) {
  const k = (company || "USA").toUpperCase();
  return k === "USA" ? "vendor-configs" : `${k.toLowerCase()}-vendor-configs`;
}

async function getVendorConfigs(company) {
  try {
    const store = getBlobStore();
    const data = await store.get(vendorsBlobKey(company), { type: "json" });
    return data || [];
  } catch { return []; }
}

async function saveVendorConfigs(company, configs) {
  const store = getBlobStore();
  await store.setJSON(vendorsBlobKey(company), configs);
}

function overridesBlobKey(company) {
  const k = (company || "USA").toUpperCase();
  return k === "USA" ? "system-email-overrides" : `${k.toLowerCase()}-system-email-overrides`;
}

async function getSystemOverrides(company) {
  try {
    const store = getBlobStore();
    const data = await store.get(overridesBlobKey(company), { type: "json" });
    return data || {};
  } catch { return {}; }
}

async function saveSystemOverrides(company, overrides) {
  const store = getBlobStore();
  await store.setJSON(overridesBlobKey(company), overrides);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  const params = event.queryStringParameters || {};
  const company = params.company || "USA";

  try {
    // GET — list all vendor configs for a company
    if (event.httpMethod === "GET") {
      const configs = await getVendorConfigs(company);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, vendors: configs, company }) };
    }

    // POST — add or update a vendor config
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { action } = body;

      if (action === "add") {
        const vendor = body.vendor;
        if (!vendor?.qb_name || !vendor?.emails?.length) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "qb_name and at least one email required" }) };
        }

        const configs = await getVendorConfigs(company);

        // Check for duplicate QB name
        if (configs.find(v => v.qb_name.toLowerCase() === vendor.qb_name.toLowerCase())) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Vendor "${vendor.qb_name}" already exists` }) };
        }

        const newVendor = {
          id: `v-${Date.now()}`,
          qb_name: vendor.qb_name,
          emails: vendor.emails,
          currency: vendor.currency || null,
          payment_terms: vendor.payment_terms || "Net 30",
          line_rules: vendor.line_rules || [],  // [{pattern: "Freight charges", account: "Shipping and delivery expense"}]
          options: {
            invoice_only_filename: vendor.options?.invoice_only_filename || false,
            combine_lines: vendor.options?.combine_lines !== false,
            eur_only: vendor.options?.eur_only || false,
          },
          created_at: new Date().toISOString(),
          active: true,
        };

        configs.push(newVendor);
        await saveVendorConfigs(company, configs);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, vendor: newVendor, message: `Vendor "${newVendor.qb_name}" added` }) };
      }

      if (action === "update") {
        const { id, updates } = body;
        const configs = await getVendorConfigs(company);
        const idx = configs.findIndex(v => v.id === id);
        if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: "Vendor not found" }) };

        configs[idx] = { ...configs[idx], ...updates, updated_at: new Date().toISOString() };
        await saveVendorConfigs(company, configs);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, vendor: configs[idx] }) };
      }

      if (action === "delete") {
        const { id } = body;
        const configs = await getVendorConfigs(company);
        const filtered = configs.filter(v => v.id !== id);
        await saveVendorConfigs(company, filtered);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Vendor removed" }) };
      }

      // System vendor email overrides
      if (action === "get-system-overrides") {
        const overrides = await getSystemOverrides(company);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrides }) };
      }

      if (action === "add-system-email") {
        const { vendor_name, email } = body;
        if (!vendor_name || !email) return { statusCode: 400, headers, body: JSON.stringify({ error: "vendor_name and email required" }) };
        const overrides = await getSystemOverrides(company);
        if (!overrides[vendor_name]) overrides[vendor_name] = [];
        if (!overrides[vendor_name].includes(email.toLowerCase())) {
          overrides[vendor_name].push(email.toLowerCase());
          await saveSystemOverrides(company, overrides);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrides }) };
      }

      if (action === "remove-system-email") {
        const { vendor_name, email } = body;
        const overrides = await getSystemOverrides(company);
        if (overrides[vendor_name]) {
          overrides[vendor_name] = overrides[vendor_name].filter(e => e !== email.toLowerCase());
          if (!overrides[vendor_name].length) delete overrides[vendor_name];
          await saveSystemOverrides(company, overrides);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrides }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action. Use add, update, or delete." }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (e) {
    console.error("vendor-config error:", e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

// Export for use by other functions
module.exports.getVendorConfigs = getVendorConfigs;
module.exports.getSystemOverrides = getSystemOverrides;
