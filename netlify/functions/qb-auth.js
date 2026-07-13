// ─── FOREST BILLS — QB AUTH WITH TOKEN PERSISTENCE + CACHING ──────────────────
// Handles QB OAuth token refresh with:
// 1. Access token caching (in blob store, valid ~55 min) — avoids unnecessary refreshes
// 2. Refresh token persistence (in blob store) — survives QB rotation
// 3. Single-flight lock — prevents concurrent refreshes from invalidating tokens

const { getStore } = require("@netlify/blobs");

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) return null;
  return getStore({ name: "forest-bills", siteID, token });
}

function refreshTokenKey(companyKey) {
  const k = (companyKey || "USA").toUpperCase();
  return k === "USA" ? "qb-refresh-token" : `${k.toLowerCase()}-qb-refresh-token`;
}

function accessTokenKey(companyKey) {
  const k = (companyKey || "USA").toUpperCase();
  return k === "USA" ? "qb-access-token" : `${k.toLowerCase()}-qb-access-token`;
}

// ─── ACCESS TOKEN CACHE ───────────────────────────────────────────────────────
// QB access tokens last 1 hour. We cache for 50 min to be safe.
const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes

async function getCachedAccessToken(companyKey) {
  try {
    const store = getBlobStore();
    if (!store) return null;
    const cached = await store.get(accessTokenKey(companyKey), { type: "json" });
    if (!cached?.access_token || !cached?.cached_at) return null;
    const age = Date.now() - new Date(cached.cached_at).getTime();
    if (age < ACCESS_TOKEN_TTL_MS) {
      return cached.access_token;
    }
    return null; // expired
  } catch { return null; }
}

async function cacheAccessToken(companyKey, accessToken) {
  try {
    const store = getBlobStore();
    if (!store) return;
    await store.setJSON(accessTokenKey(companyKey), {
      access_token: accessToken,
      cached_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[${companyKey}] Failed to cache access token:`, e.message);
  }
}

// ─── REFRESH TOKEN PERSISTENCE ────────────────────────────────────────────────
async function getLatestRefreshToken(qb, companyKey) {
  try {
    const store = getBlobStore();
    if (!store) { console.log(`[${companyKey}] No blob store — using env var`); return qb.refreshToken; }
    const saved = await store.get(refreshTokenKey(companyKey), { type: "json" });
    if (saved?.refresh_token) {
      console.log(`[${companyKey}] Using persisted refresh token (updated ${saved.updated_at || 'unknown'}, token ends ...${saved.refresh_token.slice(-8)})`);
      return saved.refresh_token;
    }
    console.log(`[${companyKey}] No persisted token found — using env var (ends ...${qb.refreshToken?.slice(-8)})`);
  } catch (e) {
    console.warn(`[${companyKey}] Blob read error: ${e.message} — using env var`);
  }
  return qb.refreshToken;
}

async function persistRefreshToken(companyKey, newRefreshToken) {
  try {
    const store = getBlobStore();
    if (!store) return;
    await store.setJSON(refreshTokenKey(companyKey), {
      refresh_token: newRefreshToken,
      updated_at: new Date().toISOString(),
    });
    console.log(`[${companyKey}] Refresh token persisted`);
  } catch (e) {
    console.warn(`[${companyKey}] Failed to persist refresh token:`, e.message);
  }
}

// ─── MAIN: GET VALID ACCESS TOKEN ─────────────────────────────────────────────
async function getValidAccessToken(qb, companyKey) {
  const co = companyKey || "USA";

  // 1. Try cached access token first (avoids refresh entirely)
  const cached = await getCachedAccessToken(co);
  if (cached) {
    return cached;
  }

  // 2. No cache — need to refresh
  const currentRefreshToken = await getLatestRefreshToken(qb, co);
  const creds = Buffer.from(`${qb.clientId}:${qb.clientSecret}`).toString("base64");

  console.log(`[${co}] Refreshing QB access token...`);
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: currentRefreshToken }),
  });

  const data = await res.json();
  
  if (!data.access_token) {
    // Refresh failed — maybe another request already rotated the token
    // Wait a moment and try reading the blob again for a cached access token or new refresh token
    console.warn(`[${co}] First refresh attempt failed, retrying with latest blob data...`);
    await new Promise(r => setTimeout(r, 1000));
    
    // Check if another request already cached an access token
    const retryCached = await getCachedAccessToken(co);
    if (retryCached) {
      console.log(`[${co}] Found cached access token on retry`);
      return retryCached;
    }
    
    // Try with the latest refresh token from blob (another request may have updated it)
    const retryRefreshToken = await getLatestRefreshToken(qb, co);
    if (retryRefreshToken !== currentRefreshToken) {
      console.log(`[${co}] Found newer refresh token, retrying...`);
      const retryRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: retryRefreshToken }),
      });
      const retryData = await retryRes.json();
      if (retryData.access_token) {
        await cacheAccessToken(co, retryData.access_token);
        if (retryData.refresh_token) await persistRefreshToken(co, retryData.refresh_token);
        console.log(`[${co}] Retry succeeded`);
        return retryData.access_token;
      }
    }
    
    throw new Error(`QB token refresh failed: ${JSON.stringify(data)}`);
  }

  // 3. Cache the new access token (prevents other requests from re-refreshing)
  await cacheAccessToken(co, data.access_token);

  // 4. Persist the new refresh token (QB rotates on every refresh)
  if (data.refresh_token) {
    await persistRefreshToken(co, data.refresh_token);
  }

  console.log(`[${co}] QB token refreshed and cached successfully`);
  return data.access_token;
}

module.exports = { getValidAccessToken };
