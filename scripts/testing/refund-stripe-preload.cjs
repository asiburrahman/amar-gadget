"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Node transport preload. */
// Only the isolated smoke child loads this file. Production has no configurable
// Stripe host or alternate provider implementation.
const http = require("node:http"), https = require("node:https");
const destination = new URL(process.env.AUDIT_REFUND_STRIPE_FIXTURE || "");
if (destination.protocol !== "http:" || destination.hostname !== "127.0.0.1" || !destination.port || destination.pathname !== "/" || destination.search || destination.hash) throw new Error("Use an exact loopback Stripe fixture.");
const original = https.request;
https.request = function(options, callback) {
  if (typeof options !== "object" || options instanceof URL || (options.hostname || options.host) !== "api.stripe.com") return original.apply(this, arguments);
  const request = http.request({ ...options, protocol: "http:", hostname: destination.hostname, host: destination.hostname, port: destination.port, agent: undefined, headers: { ...options.headers, "x-audit-fixture-token": process.env.AUDIT_REFUND_STRIPE_TOKEN } }, callback);
  // The real SDK waits for TLS's secureConnect before writing its payload.
  // This exact loopback-only transport substitutes the TCP connect event.
  request.once("socket", (socket) => { if (socket.connecting) socket.once("connect", () => socket.emit("secureConnect")); });
  return request;
};
