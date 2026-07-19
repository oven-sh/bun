// Stress half of bun-serve-static: body read via res[method]() *after* touching
// res.body (materialises a ReadableStream before the buffered-read fast path).
// Split from the sibling "-no-body" file so each half stays well inside the
// per-file wall clock on a slow runner while doing the full 4MB × 64 × 24 loop.
import type { Server } from "bun";
import { afterAll, beforeAll, describe, test } from "bun:test";
import { isBroken, isMacOS } from "harness";
import { routes, runStress, stressMethods, stressPaths } from "./bun-serve-static-helpers";

describe.todoIf(isBroken && isMacOS)("static (stress, access .body)", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      static: routes,
      port: 0,
      fetch: () => new Response("fallback", { status: 404 }),
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  describe.each(stressPaths)("%s", path => {
    test.each(stressMethods)("%s", method => runStress(server, path, true, method), 40 * 1000);
  });
});
