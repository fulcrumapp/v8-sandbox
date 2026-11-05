"use strict";

function npmErrorResponse(output) {
  const text = (output || "").trim();
  if (!text) return null;
  const embedded = text.match(/^(\{\s*\n[\s\S]*?^\})\s*$/m)?.[1];
  try {
    return JSON.parse(embedded || text);
  } catch {
    return null;
  }
}

module.exports = { npmErrorResponse };
