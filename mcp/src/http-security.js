function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function extractBearerToken(value) {
  const match = firstHeader(value)?.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
}

export function validateHttpRequest(request, config) {
  if (request.method !== "POST") {
    return { ok: false, status: 405, message: "Method not allowed" };
  }

  const host = firstHeader(request.headers.host)?.toLowerCase();
  const allowedHosts = config.allowedHosts.map(value => value.toLowerCase());
  if (!host || !allowedHosts.includes(host)) {
    return { ok: false, status: 403, message: "Host is not allowed" };
  }

  const origin = firstHeader(request.headers.origin);
  if (origin && !config.allowedOrigins.includes(origin)) {
    return { ok: false, status: 403, message: "Origin is not allowed" };
  }

  const contentType = firstHeader(request.headers["content-type"]) || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, status: 415, message: "Content-Type must be application/json" };
  }

  const contentLength = Number(firstHeader(request.headers["content-length"]));
  if (Number.isFinite(contentLength) && contentLength > config.bodyLimitBytes) {
    return { ok: false, status: 413, message: "Request body is too large" };
  }

  return { ok: true };
}

export async function readJsonBody(request, limitBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limitBytes) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}
