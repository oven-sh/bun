import type { Server } from "bun";
import { serve } from "bun";
import { afterAll, beforeAll } from "bun:test";

let server: Server;

beforeAll(() => {
  server = serve({
    port: 4545,
    fetch(request: Request): Response {
      const { url } = request;
      const { pathname, search } = new URL(url);
      const redirect = new URL(
        `${pathname}?${search}`,
        "https://raw.githubusercontent.com/denoland/deno/main/cli/tests/testdata/",
      );
      return Response.redirect(redirect.toString());
    },
  });
});

afterAll(() => {
  if (server) {
    server.stop(true);
  }
});
