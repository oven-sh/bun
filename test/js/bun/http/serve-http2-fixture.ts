// Server fixture for serve-http2.test.ts. One long-lived Bun.serve({ http2: true })
// per describe block, driven over real sockets by the test. Prints its port as
// JSON on stdout once listening and stops on stdin EOF.
//
//   bun serve-http2-fixture.ts --big-file <path> [--tls] [--no-http1] [--http3] [--idle-timeout <s>]
import { serve } from "bun";
import { tls as tlsCert } from "harness";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    tls: { type: "boolean", default: false },
    http1: { type: "boolean", default: true },
    http3: { type: "boolean", default: false },
    "idle-timeout": { type: "string", default: "30" },
    "big-file": { type: "string" },
  },
  allowNegative: true,
});
const bigFile = args["big-file"]!;

const big = Buffer.alloc(5 * 1024 * 1024, "abcdefghijklmnop");
let lateRead: PromiseWithResolvers<void> | undefined;

const makeRoutes = () => ({
  "/api/:id": (req: Bun.BunRequest<"/api/:id">) =>
    new Response("id=" + req.params.id, { headers: { "x-route": "api" } }),
  "/route-only": { POST: () => new Response("posted") },
  "/static": new Response("from-static-route", { headers: { "content-type": "text/plain", etag: '"v1"' } }),
  "/static-hop": new Response("hop", {
    headers: { connection: "keep-alive", "keep-alive": "timeout=5", te: "gzip", "x-kept": "1" },
  }),
  "/file-hop": new Response(Bun.file(bigFile), { headers: { connection: "close", upgrade: "x", "x-kept": "1" } }),
  "/file-route": Bun.file(bigFile),
  "/cookies": (req: Bun.BunRequest) => {
    req.cookies.set("seen", (req.cookies.get("seen") ?? "") + "x");
    return new Response("ok");
  },
});

const server = serve({
  port: 0,
  tls: args.tls ? tlsCert : undefined,
  http2: true,
  http1: args.http1,
  http3: args.http3,
  idleTimeout: Number(args["idle-timeout"]),
  routes: makeRoutes(),
  fetch: handler,
  websocket: { message() {} },
});

async function handler(req: Request, server: Bun.Server<undefined>): Promise<Response | undefined> {
  const url = new URL(req.url);
  switch (url.pathname) {
    case "/hello":
      return new Response("hello", { headers: { "x-proto": "h2", "content-type": "text/plain" } });
    case "/echo": {
      const body = await req.text();
      return new Response(body, {
        status: 201,
        headers: { "x-method": req.method, "x-echo": req.headers.get("x-echo") ?? "", "x-len": String(body.length) },
      });
    }
    case "/echo-bytes": {
      const body = await req.arrayBuffer();
      return new Response(body, { headers: { "x-len": String(body.byteLength) } });
    }
    case "/digest": {
      const hash = new Bun.CryptoHasher("sha256");
      let n = 0;
      for await (const chunk of req.body!) {
        hash.update(chunk);
        n += chunk.byteLength;
      }
      return new Response(hash.digest("hex"), { headers: { "x-len": String(n) } });
    }
    case "/big":
      return new Response(big, { headers: { "content-type": "application/octet-stream" } });
    case "/stream": {
      let i = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (i++ >= 64) return controller.close();
            controller.enqueue(new TextEncoder().encode("chunk" + i + Buffer.alloc(1019, ";").toString()));
          },
        }),
        { headers: { "content-type": "text/plain" } },
      );
    }
    case "/file":
      return new Response(Bun.file(bigFile));
    case "/file-stream":
      return new Response(Bun.file(bigFile).stream());
    case "/status/204":
      return new Response(null, { status: 204, headers: { "x-empty": "1" } });
    case "/headers": {
      const out: Record<string, string> = {};
      for (const [k, v] of req.headers) out[k] = v;
      return Response.json({ url: req.url, method: req.method, headers: out });
    }
    case "/body-null":
      return new Response(String(req.body === null), { headers: { "x-method": req.method } });
    case "/set-cookies":
      return new Response("ok", {
        headers: [
          ["set-cookie", "a=1"],
          ["set-cookie", "b=2"],
          ["x-multi", "1"],
          ["x-multi", "2"],
        ],
      });
    case "/latin1-headers": {
      // ?bits=16 serves the same value from a 16-bit string (utf-16le decode).
      const value =
        url.searchParams.get("bits") === "16"
          ? new TextDecoder("utf-16le").decode(new Uint16Array([0x63, 0x61, 0x66, 0xe9, 0x2d, 0x80, 0xff]))
          : "caf\u00e9-\u0080\u00ff";
      return new Response("ok", {
        headers: [
          ["content-disposition", value],
          ["set-cookie", `a=${value}`],
        ],
      });
    }
    case "/many-headers": {
      const h = new Headers();
      for (let i = 0; i < 3000; i++) h.set("x-header-" + i, "x-value-" + i);
      return new Response("ok", { headers: h });
    }
    case "/hop-headers":
      return new Response("hi", {
        headers: {
          "transfer-encoding": "chunked",
          connection: "close",
          "keep-alive": "timeout=5",
          upgrade: "websocket",
          "proxy-connection": "x",
          "x-kept": "1",
        },
      });
    case "/empty":
      return new Response("");
    // One chunk on the wire, then the stream errors.
    case "/stream-error": {
      let sent = false;
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(new TextEncoder().encode("partial"));
              await Bun.sleep(10);
            } else c.error(new Error("boom"));
          },
        }),
      );
    }
    case "/pull-1mb": {
      // 8 x 1 MiB, each pull resolved from a microtask so every write lands
      // outside a socket event.
      let i = 0;
      return new Response(
        new ReadableStream({
          async pull(c) {
            await null;
            if (i++ < 8) c.enqueue(new Uint8Array(1 << 20).fill(i));
            else c.close();
          },
        }),
      );
    }
    case "/big-headers": {
      const n = Number(url.searchParams.get("kb") ?? "12");
      return new Response("x", { headers: { "x-pad": Buffer.alloc(n * 1024, "p").toString() } });
    }
    case "/small":
      return Response.json({ ok: true });
    case "/fixed":
      return new Response(Buffer.alloc(Number(url.searchParams.get("n") ?? "264"), "a"));
    case "/read-report": {
      try {
        await req.text();
        console.error("READ-OK");
      } catch {
        console.error("READ-ERR");
      }
      return new Response("x");
    }
    case "/infinite":
      return new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(16384));
          },
          cancel() {
            console.error("CANCELLED");
          },
        }),
      );
    case "/slow-read": {
      // Consumes the body with a pause after every chunk; ?ms= sets the pause.
      const ms = Number(url.searchParams.get("ms") ?? "0");
      let n = 0;
      for await (const c of req.body!) {
        n += c.length;
        if (ms) await Bun.sleep(ms);
      }
      return new Response(String(n));
    }
    case "/ip":
      return Response.json(server.requestIP(req));
    case "/upgrade":
      return new Response(String(server.upgrade(req)), { status: 200 });
    case "/ws":
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    case "/late-read": {
      // Reads the body only once GET /release-late-read arrives.
      await (lateRead ??= Promise.withResolvers()).promise;
      let n = 0;
      for await (const c of req.body!) n += c.length;
      return new Response(String(n));
    }
    case "/release-late-read":
      (lateRead ??= Promise.withResolvers()).resolve();
      lateRead = undefined;
      return new Response("released");
    case "/slow": {
      await Bun.sleep(Number(url.searchParams.get("ms") ?? "50"));
      return new Response("slow");
    }
    case "/abort": {
      const { promise, resolve } = Promise.withResolvers<void>();
      req.signal.addEventListener("abort", () => {
        console.error("ABORTED");
        resolve();
      });
      await promise;
      return new Response("unreachable");
    }
    case "/passthrough":
      return new Response(req.body, { headers: { "x-passthrough": "1" } });
    case "/stop":
      setTimeout(() => server.stop(), 0);
      return new Response("stopping");
    case "/reload":
      server.reload({
        routes: { ...makeRoutes(), "/reloaded-route": new Response("after-reload") },
        fetch: handler,
        websocket: { message() {} },
      });
      return new Response("reloaded");
    case "/keepalive": {
      server.timeout(req, 0);
      const { promise, resolve } = Promise.withResolvers<void>();
      req.signal.addEventListener("abort", () => {
        console.error("KEEPALIVE-ABORTED");
        resolve();
      });
      setTimeout(resolve, Number(url.searchParams.get("ms")));
      await promise;
      return new Response(req.signal.aborted ? "aborted" : "kept");
    }
    // server.timeout(req, s), then sleep ms before answering.
    case "/t": {
      const s = url.searchParams.get("s")!;
      server.timeout(req, Number(s));
      await Bun.sleep(Number(url.searchParams.get("ms")));
      return new Response("t" + s);
    }
  }
  return new Response("not found: " + url.pathname, { status: 404 });
}

console.log(JSON.stringify({ port: server.port }));
process.stdin.on("end", () => {
  server.stop(true);
  process.stderr.write("", () => process.exit(0));
});
process.stdin.resume();
