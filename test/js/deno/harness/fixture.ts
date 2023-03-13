import type { Server } from "bun";
import { serve } from "bun";
import { afterAll, beforeAll } from "bun:test";
import baseUrl from "../resources/url.json";

let server: Server;

beforeAll(() => {
  server = serve({
    port: 4545,
    fetch(request: Request): Response {
      const { url } = request;
      const { pathname, search } = new URL(url);
      if (pathname === "/echo_server") {
        return new Response(request.body, request);
      }
      const redirect = new URL(`${pathname}?${search}`, baseUrl);
      return Response.redirect(redirect.toString());
    },
  });
});

afterAll(() => {
  if (server) {
    server.stop(true);
  }
});

export async function readTextFile(path: string): Promise<string> {
  const url = new URL(path, baseUrl);
  const response = await fetch(url);
  if (response.ok) {
    return response.text();
  }
  throw new Error(`${response.status}: ${response.url}`);
}
