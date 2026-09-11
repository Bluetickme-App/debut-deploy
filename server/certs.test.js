// node --test server/certs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { classifyCert, probeCertificate, certProbeTargets, CERT_EXPIRY_WARN_DAYS } from "./certs.js";

const NOW = Date.parse("2026-09-11T00:00:00Z");
const inDays = (n) => new Date(NOW + n * 86_400_000).toUTCString();

test("classifyCert: a trusted, long-lived cert is ok", () => {
  const c = classifyCert({ authorized: true, validTo: inDays(60), issuer: { CN: "YR2", O: "Let's Encrypt" } }, NOW);
  assert.equal(c.state, "ok");
});

// The exact failure that sat unnoticed on iappraisal.co.uk while the app returned 200.
test("classifyCert: Traefik's self-signed default is untrusted, and names the issuer", () => {
  const c = classifyCert(
    { authorized: false, authorizationError: "SELF_SIGNED_CERT_IN_CHAIN", validTo: inDays(365), issuer: { CN: "TRAEFIK DEFAULT CERT" } },
    NOW,
  );
  assert.equal(c.state, "untrusted");
  assert.match(c.detail, /TRAEFIK DEFAULT CERT/);
});

test("classifyCert: untrusted with no issuer falls back to the validation error", () => {
  const c = classifyCert({ authorized: false, authorizationError: "CERT_HAS_EXPIRED", validTo: inDays(-1) }, NOW);
  assert.equal(c.state, "untrusted");
  assert.match(c.detail, /CERT_HAS_EXPIRED/);
});

test("classifyCert: a valid cert inside the renewal window is flagged as expiring", () => {
  const c = classifyCert({ authorized: true, validTo: inDays(CERT_EXPIRY_WARN_DAYS - 1), issuer: { CN: "YR2" } }, NOW);
  assert.equal(c.state, "expiring");
  assert.equal(c.daysLeft, CERT_EXPIRY_WARN_DAYS - 1);
});

test("classifyCert: an unparseable expiry does not invent an expiring cert", () => {
  assert.equal(classifyCert({ authorized: true, validTo: "not a date" }, NOW).state, "ok");
});

// --- probeCertificate: a fake socket, so no network is touched -------------------

function fakeConnect({ authorized, cert, failWith, timeout }) {
  return (_opts, onSecure) => {
    const socket = new EventEmitter();
    socket.authorized = authorized;
    socket.authorizationError = "SELF_SIGNED_CERT_IN_CHAIN";
    socket.getPeerCertificate = () => cert;
    socket.destroy = () => {};
    queueMicrotask(() => {
      if (failWith) socket.emit("error", new Error(failWith));
      else if (timeout) socket.emit("timeout");
      else onSecure();
    });
    return socket;
  };
}

test("probeCertificate: reads the peer certificate and classifies it", async () => {
  const connect = fakeConnect({ authorized: false, cert: { valid_to: inDays(300), issuer: { CN: "TRAEFIK DEFAULT CERT" } } });
  const r = await probeCertificate("example.test", { connect, nowMs: () => NOW });
  assert.equal(r.domain, "example.test");
  assert.equal(r.state, "untrusted");
});

// This distinction is load-bearing: `unknown` must never reach the remediator, or a
// momentary network failure would restart a healthy app.
test("probeCertificate: a connection error is unknown, NOT untrusted", async () => {
  const r = await probeCertificate("down.test", { connect: fakeConnect({ failWith: "ECONNREFUSED" }), nowMs: () => NOW });
  assert.equal(r.state, "unknown");
});

test("probeCertificate: a timeout is unknown, and resolves rather than hanging", async () => {
  const r = await probeCertificate("slow.test", { connect: fakeConnect({ timeout: true }), timeoutMs: 10, nowMs: () => NOW });
  assert.equal(r.state, "unknown");
});

test("probeCertificate: a throwing connect is caught, not propagated", async () => {
  const connect = () => { throw new Error("getaddrinfo ENOTFOUND"); };
  const r = await probeCertificate("nope.test", { connect, nowMs: () => NOW });
  assert.equal(r.state, "unknown");
});

// --- certProbeTargets ------------------------------------------------------------

test("certProbeTargets: skips sslip.io, ports and blanks; keeps real domains", () => {
  const out = certProbeTargets([
    { uuid: "a", name: "Zenway", domain: "zenway.debutdepoly.com" },
    { uuid: "b", name: "ml", domain: "u11c6r4.157.90.244.221.sslip.io" },
    { uuid: "c", name: "vnc", domain: "vnc-kourtney.157.90.244.221.sslip.io:6080" },
    { uuid: "d", name: "none", domain: "" },
    { uuid: "e", name: "nodots", domain: "localhost" },
  ]);
  assert.deepEqual(out.map((t) => t.uuid), ["a"]);
});

test("certProbeTargets: tolerates a null service list", () => {
  assert.deepEqual(certProbeTargets(null), []);
});
