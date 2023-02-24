import { describe, expect, test } from "bun:test";

describe("Server", () => {
  test("returns active port when initializing server with 0 port", () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    expect(server.port).not.toBe(0);
    expect(server.port).toBeDefined();
    server.stop();
  });

  test("allows connecting to server", async () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe("Hello");
    server.stop();
  });

  test('abort signal on server', async ()=> {
    {
      let signalOnServer = false;
      const server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
          });
          await Bun.sleep(3000);
          return new Response("Hello");
        },
        port: 54321,
      });
    
      try {
        await fetch("http://localhost:54321", { signal: AbortSignal.timeout(100) });
      } catch {}
      await Bun.sleep(300);
      expect(signalOnServer).toBe(true);
      server.stop();
    }
    
  })
});
