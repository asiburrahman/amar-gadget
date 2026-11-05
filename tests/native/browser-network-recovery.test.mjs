import assert from "node:assert/strict";
import test from "node:test";
import { captureBrowserRead, sameOriginWebKitDiagnostic } from "../../scripts/testing/browser-network-recovery.mjs";

const origin = "https://127.0.0.1:32100";
function request(path, method = "GET", body = null, headers = {}) {
  return { url: () => origin + path, method: () => method, postData: () => body, headers: () => headers };
}

test("network recovery preserves the captured read method/body and RSC headers", () => {
  assert.deepEqual(captureBrowserRead(request("/products?_rsc=read", "GET", null, { rsc: "1", "next-router-prefetch": "1", cookie: "must-not-copy", authorization: "must-not-copy" }), origin), {
    url: origin + "/products?_rsc=read", method: "GET", headers: { rsc: "1", "next-router-prefetch": "1" },
  });
  const body = JSON.stringify({ lines: [{ productId: "local", quantity: 1 }] });
  assert.deepEqual(captureBrowserRead(request("/api/cart/guest", "POST", body, { "content-type": "application/json; charset=utf-8" }), origin), {
    url: origin + "/api/cart/guest", method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
});

test("network recovery never replays arbitrary mutations or a foreign origin", () => {
  for (const path of ["/api/orders", "/api/auth/logout", "/api/checkout/local", "/api/cart/guest?extra=1"]) {
    assert.equal(captureBrowserRead(request(path, "POST", "{}", { "content-type": "application/json" }), origin), null);
  }
  assert.equal(captureBrowserRead(request("/api/cart/guest", "DELETE"), origin), null);
  assert.equal(captureBrowserRead(request("/products"), "https://127.0.0.1:32101"), null);
});

test("network recovery rejects missing, invalid, non-JSON and oversized POST bodies", () => {
  for (const body of [null, "{", "x".repeat(65_537)]) {
    assert.equal(captureBrowserRead(request("/api/cart/guest", "POST", body, { "content-type": "application/json" }), origin), null);
  }
  assert.equal(captureBrowserRead(request("/api/cart/guest", "POST", "{}", { "content-type": "text/plain" }), origin), null);
});

test("only the exact same-origin WebKit network diagnostic is eligible", () => {
  const error = { name: "Fetch API cannot load https", message: "/127.0.0.1:32100/api/cart/guest due to access control checks." };
  assert.equal(sameOriginWebKitDiagnostic(error, origin), origin + "/api/cart/guest");
  assert.equal(sameOriginWebKitDiagnostic({ ...error, name: "Error" }, origin), null);
  assert.equal(sameOriginWebKitDiagnostic(error, "https://127.0.0.1:32101"), null);
  assert.equal(sameOriginWebKitDiagnostic({ ...error, message: "/external.example/data due to access control checks." }, origin), null);
  assert.equal(sameOriginWebKitDiagnostic({ ...error, message: "/127.0.0.1:999999/data due to access control checks." }, origin), null);
});
