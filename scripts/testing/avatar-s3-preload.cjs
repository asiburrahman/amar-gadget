"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Node's --require smoke preload executes as CommonJS. */
// Local smoke process only: transport actual signed SDK requests to the
// SigV4-verifying loopback provider. Application configuration/code has no
// alternate provider URL or environment-controlled storage bypass.
const http = require("node:http"), https = require("node:https");
const destination = new URL(process.env.AUDIT_AVATAR_S3_FIXTURE || "");
if (destination.protocol !== "http:" || destination.hostname !== "127.0.0.1" || !destination.port || destination.pathname !== "/" || destination.search || destination.hash) throw new Error("Use an exact local avatar fixture listener.");
const original = https.request;
const host = `fixture-media.${"a".repeat(32)}.r2.cloudflarestorage.com`;
https.request = function(options, callback) {
  if (typeof options !== "object" || options instanceof URL || (options.hostname || options.host) !== host) return original.apply(this, arguments);
  return http.request({ ...options, protocol: "http:", hostname: destination.hostname, host: destination.hostname, port: destination.port, agent: undefined, headers: { ...options.headers, host } }, callback);
};
