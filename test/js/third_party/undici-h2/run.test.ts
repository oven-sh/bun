// Runs undici's vendored test/fetch/http2.js against Bun's built-in fetch()
// over the experimental HTTP/2 client path. Each undici sub-test registers
// itself via node:test, which Bun's runner surfaces individually.
//
// Update by re-copying from a fresh undici checkout and re-applying the
// import rewrite at the top of http2.js (see undici-shim.mjs).

// The shim forces protocol:"http2" per request, so the env feature-flag is
// not needed (and process.env writes don't reach the C environ anyway).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

await import("./http2.js");
