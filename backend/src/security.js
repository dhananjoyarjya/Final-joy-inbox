const crypto = require("crypto");

function getHeader(event, headerName) {
  const headers = event.headers || {};
  const target = headerName.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return undefined;
}

function getRawBody(event) {
  if (!event.body) {
    return Buffer.from("");
  }

  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64");
  }

  return Buffer.from(event.body, "utf8");
}

function verifyMetaSignature(event) {
  const appSecret =
    process.env.META_APP_SECRET ||
    process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    throw new Error("Meta App Secret is not configured.");
  }

  const signature = getHeader(
    event,
    "x-hub-signature-256"
  );

  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const rawBody = getRawBody(event);

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

function getCorsOrigin(event) {
  const allowedOrigins = (
    process.env.CORS_ORIGINS || ""
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const requestOrigin = getHeader(event, "origin");

  if (!requestOrigin) {
    return "";
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return "";
}

function jsonResponse(event, statusCode, body) {
  const origin = getCorsOrigin(event);

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

function textResponse(event, statusCode, body) {
  const origin = getCorsOrigin(event);

  const headers = {
    "Content-Type": "text/plain",
    "Cache-Control": "no-store"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return {
    statusCode,
    headers,
    body: String(body)
  };
}

module.exports = {
  getHeader,
  getRawBody,
  verifyMetaSignature,
  jsonResponse,
  textResponse
};
