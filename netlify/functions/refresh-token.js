const { getCompanyConfig, getQBEnvVars } = require("./company-config");
const { getValidAccessToken } = require("./qb-auth");

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Key", "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const { checkAuth } = require("./auth");
  const authFail = checkAuth(event);
  if (authFail) return authFail;

  try {
    const params = event.queryStringParameters || {};
    const company = params.company || "USA";
    const config = getCompanyConfig(company);
    const qb = getQBEnvVars(config);

    if (!qb.clientId || !qb.clientSecret || !qb.refreshToken) throw new Error(`QB OAuth credentials not configured for ${config.entity}`);

    const accessToken = await getValidAccessToken(qb, company);

    return { statusCode: 200, headers, body: JSON.stringify({
      success: true, company, entity: config.entity,
      access_token: accessToken,
      message: `Token refreshed and persisted for ${config.entity}`,
    }) };
  } catch (err) { return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }; }
};
