import { expect, test } from "bun:test";
import { bunEnv } from "harness";
import http from "node:http";
import path from "path";

test("maxHeaderSize", async () => {
  const originalMaxHeaderSize = http.maxHeaderSize;
  expect(http.maxHeaderSize).toBe(16 * 1024);
  // @ts-expect-error its a liar
  http.maxHeaderSize = 1024;
  expect(http.maxHeaderSize).toBe(1024);
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(8 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }
  http.maxHeaderSize = 16 * 1024;
  {
    using server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(JSON.stringify(req.headers, null, 2));
      },
    });

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(15 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(200);
    }

    {
      const response = await fetch(`${server.url}/`, {
        headers: {
          "Huge": Buffer.alloc(17 * 1024, "abc").toString(),
        },
      });
      expect(response.status).toBe(431);
    }
  }

  http.maxHeaderSize = originalMaxHeaderSize;
});

test("--max-http-header-size=1024", async () => {
  const size = 1024;
  bunEnv.BUN_HTTP_MAX_HEADER_SIZE = size;
  expect(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")]).toRun();
});

test("--max-http-header-size=NaN", async () => {
  expect(["--max-http-header-size=" + "NaN", path.join(import.meta.dir, "max-header-size-fixture.ts")]).not.toRun();
});

test("--max-http-header-size=16*1024", async () => {
  const size = 16 * 1024;
  bunEnv.BUN_HTTP_MAX_HEADER_SIZE = size;
  expect(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")]).toRun();
});
