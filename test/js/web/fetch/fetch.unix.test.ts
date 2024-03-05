import { serve, ServeOptions, Server } from "bun";
import { afterAll, afterEach, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmp_dir = mkdtempSync(join(realpathSync(tmpdir()), "fetch.unix.test"));

let server: Server;
function startServerUnix({ fetch, ...options }: ServeOptions): string {
  const socketPath = join(tmp_dir, `socket-${Math.random().toString(36).slice(2)}`);
  server = serve({
    ...options,
    fetch,
    unix: socketPath,
  });
  return socketPath;
}

afterEach(() => {
  server?.stop?.(true);
});

afterAll(() => {
  rmSync(tmp_dir, { force: true, recursive: true });
});

it("provide body", async () => {
  const path = startServerUnix({
    fetch(req) {
      return new Response(req.body);
    },
  });
  // POST with body
  for (let i = 0; i < 20; i++) {
    const response = await fetch("http://localhost/hello", { method: "POST", body: String(i), unix: path });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(String(i));
  }
});
