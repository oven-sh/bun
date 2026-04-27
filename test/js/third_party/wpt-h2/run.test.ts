// Runs the vendored WPT fetch .h2.any.js tests against Bun's fetch() over
// the experimental HTTP/2 client path. The .any.js files are byte-identical
// to upstream; this driver supplies the testharness globals, a wptserve
// stand-in, and a fetch() wrapper that forces ALPN h2.
//
// Vendored from web-platform-tests/wpt @ ebf8e3069ec4ac6498826bf9066419e46b0f4ac5
//   fetch/api/basic/status.h2.any.js
//   fetch/api/basic/request-upload.h2.any.js
//   fetch/api/redirect/redirect-upload.h2.any.js

import { afterAll } from "bun:test";
import { wptTest } from "./testharness-shim";
import { startServer } from "./server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { origin, close } = await startServer();
afterAll(close);

const g = globalThis as any;
g.RESOURCES_DIR = origin + "/fetch/api/resources/";
g.self = { origin };

const realFetch = globalThis.fetch;
const realRequest = globalThis.Request;

// A few tests construct `new Request("")` purely to inspect the resulting
// headers; resolve relative inputs against the test server so that doesn't
// throw before the assertion runs.
g.Request = new Proxy(realRequest, {
  construct(target, [input, init]) {
    if (typeof input === "string" && !/^[a-z]+:/.test(input)) {
      input = origin + (input.startsWith("/") ? input : "/" + input);
    }
    return Reflect.construct(target, [input, init]);
  },
});

g.fetch = (input: any, init: any = {}) => {
  let url: string;
  if (typeof input === "string") {
    if (!/^[a-z]+:/.test(input)) input = origin + (input.startsWith("/") ? input : "/" + input);
    url = input;
  } else {
    url = input.url;
  }
  if (url.startsWith("https:")) {
    init = { ...init, protocol: "http2", tls: { rejectUnauthorized: false, ...(init.tls || {}) } };
  }
  return realFetch(input, init);
};

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load each vendored file
// as text and run it inside a Function whose `test` parameter is the shim.
// All other testharness identifiers resolve via globalThis.
for (const file of ["status.h2.any.js", "request-upload.h2.any.js", "redirect-upload.h2.any.js"]) {
  const src = readFileSync(join(import.meta.dir, file), "utf8");
  new Function("test", src)(wptTest);
}
