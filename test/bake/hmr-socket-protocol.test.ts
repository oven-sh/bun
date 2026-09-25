// The HMR websocket at `/_bun/hmr` accepts frames from any connected client
// (a browser tab, an extension, anything on the LAN with `--hostname 0.0.0.0`),
// so no frame may be able to reach an `assert`/`debug_assert` in the dev
// server. These tests drive the frames that could:
//   - a second "H" (testing-batch) frame while a bundle is in flight hit the
//     `TestingBatchEvents::EnableAfterBundle` arm's `debug_assert!(false)`.
//   - "n" (SetUrl) with a pattern not starting with "/" reached
//     `FrameworkRouter::match_slow`'s `debug_assert!(path[0] == b'/')`: an
//     empty pattern indexes out of bounds inside it, any other fails it.
//   - releasing a batch with "H" while an unrelated bundle was in flight
//     reached `start_async_bundle`'s `debug_assert!(current_bundle.is_none())`.
//     On a release build that assert is compiled out and the second
//     `start_async_bundle` overwrites the in-flight `CurrentBundle`, freeing
//     the arena its parse tasks are still reading: a multi-thread segfault.
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

/** Parks any import of `hold.block` on a fetch the test controls. */
const holdPlugin = /* ts */ `
  export default {
    name: "hold-bundle",
    setup(build) {
      build.onLoad({ filter: /hold\\.block$/ }, async () => {
        await fetch(process.env.HMR_TEST_BUNDLE_GATE);
        return { contents: "export default 1;", loader: "js" };
      });
    },
  };
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
 * Connect to `/_bun/hmr`. `onFrame` gets every server frame as its message-id
 * byte plus the rest of the payload; `onClose` fires on any server-initiated
 * close (an aborting dev server looks like an abrupt close to the client).
 */
async function connectHmr(
  port: number,
  onFrame: (id: string, body: Uint8Array) => void,
  onClose: (err: Error) => void,
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/_bun/hmr`);
  ws.binaryType = "arraybuffer";
  const received: string[] = [];
  ws.onmessage = ev => {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    const id = String.fromCharCode(bytes[0]);
    received.push(id);
    onFrame(id, bytes.subarray(1));
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

test.concurrent(
  "a duplicate testing-batch frame (H) during an in-flight bundle closes the socket instead of aborting",
  async () => {
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
      "plugin.ts": holdPlugin,
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
    // If the bundle never reaches the plugin (so the gate fetch never comes),
    // fail with the dev server's output instead of hanging on bundleEntered.
    proc.exited.then(() =>
      bundleEntered.reject(
        new Error(`dev server exited before the bundle reached the plugin\n--- dev server stderr ---\n${dev.stderr()}`),
      ),
    );

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
  },
);

// "n" is an empty pattern (the out-of-bounds index flavor); "nfoo" is a
// non-absolute pattern (the failed-assertion flavor).
test.concurrent.each(["n", "nfoo"])(
  "a SetUrl frame without a leading slash (%j) closes the socket instead of aborting",
  async frame => {
    using dir = tempDir("hmr-socket-seturl", {
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

    // An aborting dev server also produces a close event, so the liveness
    // check below is what distinguishes "closed the socket" from "died".
    const closed = Promise.withResolvers<void>();
    using hmr = await connectHmr(
      port,
      () => {},
      () => closed.resolve(),
    );
    hmr.ws.send(frame);
    await closed.promise;

    let status: string;
    try {
      status = String((await fetch(`http://127.0.0.1:${port}/`)).status);
    } catch (e) {
      status = `${(e as Error).message}\n--- dev server stderr ---\n${dev.stderr()}`;
    }
    expect(status).toBe("200");
  },
);

test.concurrent("releasing a testing batch while another bundle is in flight defers it", async () => {
  // `/two` is not bundled at startup, and its entry imports `hold.block`, so
  // the first request for it parks a bundle in the plugin until this server
  // answers. That makes "a bundle is in flight" an awaited condition.
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

  using dir = tempDir("hmr-socket-batch-defer", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": holdPlugin,
    "index.html": indexHtml,
    "entry.ts": `import { value } from "./dep.ts";\nconsole.log(value);`,
    "dep.ts": `export const value = 0;`,
    "two.html": /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script type="module" src="./two.ts"></script></body></html>`,
    "two.ts": `import "./hold.block";\nconsole.log("two");`,
    "hold.block": "",
    "server.ts": /* ts */ `
      import one from "./index.html";
      import two from "./two.html";
      const server = Bun.serve({
        port: 0,
        development: { hmr: true, console: false },
        routes: { "/": one, "/two": two },
        fetch() { return new Response("fallback"); },
      });
      console.log("PORT=" + server.port);
    `,
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

  // `r` frames are the testing-synchronization codes: 0 batching started,
  // 1 the batch saw a file, 2 an empty batch was released, 3/4 a bundle
  // finished. Waiting on them keeps every step below condition-based.
  const seen = new Set<number>();
  const waiters = new Map<number, () => void>();
  const waitForSync = (code: number) =>
    new Promise<void>(resolve => {
      if (seen.delete(code)) return resolve();
      waiters.set(code, resolve);
    });

  // Only a process exit means the dev server died; a close is a close.
  const died = Promise.withResolvers<never>();
  died.promise.catch(() => {});
  proc.exited.then(() => died.reject(new Error(`dev server exited\n--- dev server stderr ---\n${dev.stderr()}`)));
  const socketClosed = Promise.withResolvers<void>();
  using hmr = await connectHmr(
    port,
    (id, body) => {
      if (id !== "r") return;
      const code = body[0];
      const waiter = waiters.get(code);
      if (waiter) {
        waiters.delete(code);
        waiter();
      } else {
        seen.add(code);
      }
    },
    () => socketClosed.resolve(),
  );
  hmr.ws.send("sr");

  // Bundle `/` so that `dep.ts` is watched and an edit to it reaches the batch.
  expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);

  // 1. "H" with no bundle running turns batching on (sync code 0).
  const batchingOn = waitForSync(0);
  hmr.ws.send("H");
  await Promise.race([batchingOn, died.promise]);

  // 2. An edit is parked in the batch instead of starting a bundle (code 1).
  const sawFile = waitForSync(1);
  await Bun.write(`${dir}/dep.ts`, `export const value = 1;`);
  await Promise.race([sawFile, died.promise]);

  // 3. The first request for `/two` starts a bundle that the plugin holds.
  const twoFetch = fetch(`http://127.0.0.1:${port}/two`);
  twoFetch.catch(() => {});
  await Promise.race([bundleEntered.promise, died.promise]);

  // 4. "H" releases the batch while that bundle is still running. Starting a
  //    second bundle here trips start_async_bundle's assert on a debug build
  //    and corrupts the in-flight bundle on a release build, so the batch has
  //    to wait for the running bundle to finish.
  hmr.ws.send("H");
  // A further "H" finds the batch pending release and closes the socket.
  // Receiving that close proves the frame above was handled while the bundle
  // was still held, which is the state this test is about.
  hmr.ws.send("H");
  await Promise.race([socketClosed.promise, died.promise]);

  bundleRelease.resolve();
  expect(
    String(
      await twoFetch.then(
        r => r.status,
        e => `${e}\n${dev.stderr()}`,
      ),
    ),
  ).toBe("200");

  // The deferred batch now runs, so both routes still serve and the edit is
  // live in the bundle for `/`.
  const reloaded = await fetch(`http://127.0.0.1:${port}/`);
  expect(reloaded.status).toBe(200);
  expect(proc.killed).toBe(false);
});
