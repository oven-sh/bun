// Bun client for the "pooled socket that is mid-renegotiation" test in
// fetch.tls.test.ts.
// argv: the <relayPort> <controlPort> of fetch.tls.renegotiation-peer-fixture.mjs
// env:  CA_CERT, the certificate of the origin
const [relayPort, controlPort] = process.argv.slice(2);
const origin = `https://127.0.0.1:${relayPort}/`;
const control = (path: string) => fetch(`http://127.0.0.1:${controlPort}${path}`).then(res => res.text());
// Verification stays on: fetch keeps no TLS session for a client without it.
const tls = { ca: process.env.CA_CERT };

// Parks the connection in the keep-alive pool and its TLS 1.2 session in
// fetch's session cache.
console.log("first", await (await fetch(origin, { tls })).text());

// The origin asks for a renegotiation and the relay holds the client's
// ClientHello, so the pooled socket stays mid-handshake until "/release".
console.log("held record type", await control("/renegotiate"));

// The pooled pickup. It is queued on the HTTP thread before the control
// request below, so once that one is answered the pickup has run. The request
// itself waits for the renegotiation, so its outcome is not part of the test.
void fetch(origin, { tls }).then(
  res => res.text(),
  () => {},
);
console.log("after the pooled pickup", await control("/ping"));

await control("/release");

// `keepalive: false` takes a connection of its own, so the origin reports
// whether the cached session is still there to offer.
console.log("third", await (await fetch(origin, { tls, keepalive: false })).text());
console.log("resumed", await control("/resumed"));
process.exit(0);
