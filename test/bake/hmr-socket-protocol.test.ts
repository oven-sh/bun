// The HMR websocket at `/_bun/hmr` accepts frames from any connected client
// (a browser tab, an extension, anything on the LAN with `--hostname 0.0.0.0`),
// so no frame may be able to reach an `assert`/`debug_assert` in the dev
// server. These tests drive the two frames that could:
//   - "sM" (subscribe to the memory-visualizer topic) reached a
//     `debug_assert!(cfg!(feature = "bake_debugging_features"))` that is never
//     true, because `HmrSocket`'s on-subscribe hook gated on a different
//     predicate than the rest of the (compiled-out) visualizer machinery.
//   - a second "H" (testing-batch) frame while a bundle was in flight hit the
//     `TestingBatchEvents::EnableAfterBundle` arm's `debug_assert!(false)`.
// Both aborted the whole dev server process in debug / assertion builds.
import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const indexHtml = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script type="module" src="./entry.ts"></script></body></html>`;

const serverTs = /* ts */ `
  import html from "./index.html";
  const server = Bun.serve({
    port: 0,
    development: { hmr: true, console: false },
    routes: { "/": html },
    fetch() { return new Response("fallback"); },
  });
  console.log("PORT=" + server.port);
`;

/** Drain stdout/stderr concurrently and resolve the port from the PORT= line. */
function watchDevServer(proc: Subprocess<"ignore", "pipe", "pipe">) {
  const port = Promise.withResolvers<number>();
  let stdout = "";
  let stderr = "";
  (async () => {
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      const m = stdout.match(/PORT=(\d+)/);
      if (m) port.resolve(parseInt(m[1], 10));
    }
    port.reject(new Error(`dev server exited before printing its port\n${stdout}${stderr}`));
  })().catch(() => {});
  (async () => {
    for await (const chunk of proc.stderr) stderr += Buffer.from(chunk).toString();
  })().catch(() => {});
  return { port: port.promise, stderr: () => stderr };
}

/**
 * Connect to `/_bun/hmr`. `onFrame` gets the message-id byte of every server
 * frame as a single-character string; `onClose` fires on any server-initiated
 * close (an aborting dev server looks like an abrupt close to the client).
 */
async function connectHmr(port: number, onFrame: (id: string) => void, onClose: (err: Error) => void) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/_bun/hmr`);
  ws.binaryType = "arraybuffer";
  const received: string[] = [];
  ws.onmessage = ev => {
    const id = String.fromCharCode(new Uint8Array(ev.data as ArrayBuffer)[0]);
    received.push(id);
    onFrame(id);
  };
  const opened = Promise.withResolvers<void>();
  ws.onopen = () => opened.resolve();
  ws.onerror = () => opened.reject(new Error("hmr websocket failed to connect"));
  ws.onclose = ev => onClose(new Error(`hmr websocket closed (code ${ev.code}, reason ${JSON.stringify(ev.reason)})`));
  await opened.promise;
  return {
    ws,
    received,
    [Symbol.dispose]() {
      ws.onclose = null;
      ws.close();
    },
  };
}

test.concurrent("a memory-visualizer subscribe frame (sM) does not abort the dev server", async () => {
  using dir = tempDir("hmr-socket-sm", {
    "index.html": indexHtml,
    "entry.ts": `console.log("entry");`,
    "server.ts": serverTs,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const dev = watchDevServer(proc);
  const port = await dev.port;

  // Resolved by the SetUrlResponse ("n") frame; rejected if the socket dies
  // first, which is what an aborting dev server looks like from the client.
  const gotSetUrlResponse = Promise.withResolvers<void>();
  using hmr = await connectHmr(
    port,
    id => id === "n" && gotSetUrlResponse.resolve(),
    err => gotSetUrlResponse.reject(new Error(`${err.message}\n--- dev server stderr ---\n${dev.stderr()}`)),
  );

  // "sM" has no reply of its own, so chase it with "n/" (SetUrl) on the same
  // socket: frames are handled in order, and SetUrl always answers with a
  // SetUrlResponse frame for a route that exists. Receiving it proves "sM"
  // was handled without killing the process.
  hmr.ws.send("sM");
  hmr.ws.send("n/");
  await gotSetUrlResponse.promise;

  // "V" is the version handshake sent on connect.
  expect(hmr.received).toEqual(["V", "n"]);
  // The process is still serving HTTP.
  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
});

test.concurrent("a duplicate testing-batch frame (H) during an in-flight bundle closes the socket instead of aborting", async () => {
  // A bundler plugin parks the bundle on a fetch to this server, so "the
  // bundle is in flight" is an awaited condition, not a sleep.
  const bundleEntered = Promise.withResolvers<void>();
  const bundleRelease = Promise.withResolvers<void>();
  await using gate = Bun.serve({
    port: 0,
    async fetch() {
      bundleEntered.resolve();
      await bundleRelease.promise;
      return new Response("go");
    },
  });

  using dir = tempDir("hmr-socket-double-h", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": /* ts */ `
      export default {
        name: "hold-bundle",
        setup(build) {
          build.onLoad({ filter: /hold\\.block$/ }, async () => {
            await fetch(process.env.HMR_TEST_BUNDLE_GATE);
            return { contents: "export default 1;", loader: "js" };
          });
        },
      };
    `,
    "index.html": indexHtml,
    "entry.ts": `import "./hold.block";\nconsole.log("entry");`,
    "hold.block": "",
    "server.ts": serverTs,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: { ...bunEnv, HMR_TEST_BUNDLE_GATE: String(gate.url) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const dev = watchDevServer(proc);
  const port = await dev.port;

  const closed = Promise.withResolvers<void>();
  using hmr = await connectHmr(
    port,
    () => {},
    () => closed.resolve(),
  );

  // Kick off the bundle for `/`; the plugin holds it open on the gate fetch.
  const pageFetch = fetch(`http://127.0.0.1:${port}/`);
  pageFetch.catch(() => {});
  await bundleEntered.promise;

  // 1st "H" with a bundle in flight: Disabled -> EnableAfterBundle.
  // 2nd "H": the EnableAfterBundle arm must close the socket, not assert.
  hmr.ws.send("H");
  hmr.ws.send("H");
  await closed.promise;

  // Release the held bundle: the deferred `/` request completes only if the
  // dev server survived the protocol violation.
  bundleRelease.resolve();
  let pageStatus: string;
  try {
    pageStatus = String((await pageFetch).status);
  } catch (e) {
    pageStatus = `${(e as Error).message}\n--- dev server stderr ---\n${dev.stderr()}`;
  }
  expect(pageStatus).toBe("200");
  // And it is still accepting new requests.
  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
});
