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
//   - "s" (Subscribe) with a topic set that drops a topic kept the uWS
//     subscription for that topic, so the socket still received its frames.
//     A hot update that only such a socket received reached
//     `put_or_increment_ref_count`'s `debug_assert!(ref_count > 0)`.
//   - "s" with topic `M` arms a timer. Its handler left the fired timer marked
//     active, so closing the socket removed it from the timer heap a second time:
//     `assert!(self.root == v)`, or a different timer dropped on a canary build.
import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isMacOS, tempDir } from "harness";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

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

test.concurrent("a subscribe frame that drops a topic stops delivery of that topic", async () => {
  // The socket subscribes to each topic set in turn. Topic `h` delivers hot
  // updates (`u`). Topic `r` delivers an `r` frame when a bundle finishes.
  //
  // Each step requests a page that is not bundled yet. The request starts one
  // bundle, and the response arrives after the dev server published the
  // frames of that bundle.
  //
  // Each page has a script of its own, so each bundle has a source map that
  // the dev server has not stored yet. Only a new source map can reach the
  // assert.
  const steps = [
    { topics: "hr", page: "/a" },
    { topics: "r", page: "/b" },
    { topics: "", page: "/c" },
    { topics: "hr", page: "/d" },
  ];
  const pageWith = (script: string) => indexHtml.replace("./entry.ts", script);
  using dir = tempDir("hmr-socket-resubscribe", {
    "index.html": indexHtml,
    "other.html": indexHtml,
    "entry.ts": `console.log("entry");`,
    "a.html": pageWith("./a.ts"),
    "b.html": pageWith("./b.ts"),
    "c.html": pageWith("./c.ts"),
    "d.html": pageWith("./d.ts"),
    "a.ts": `console.log("a");`,
    "b.ts": `console.log("b");`,
    "c.ts": `console.log("c");`,
    "d.ts": `console.log("d");`,
    "server.ts": /* ts */ `
      import index from "./index.html";
      import other from "./other.html";
      import a from "./a.html";
      import b from "./b.html";
      import c from "./c.html";
      import d from "./d.html";
      const server = Bun.serve({
        port: 0,
        development: { hmr: true, console: false },
        routes: { "/": index, "/other": other, "/a": a, "/b": b, "/c": c, "/d": d },
        fetch() { return new Response("fallback"); },
      });
      console.log("PORT=" + server.port);
    `,
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

  // A process exit and a socket close reject `failed` at once.
  const failed = Promise.withResolvers<never>();
  failed.promise.catch(() => {});
  proc.exited.then(() => failed.reject(new Error("dev server exited")));
  /** Awaits `promise`. Its failure, a process exit, or a socket close rejects with the dev server's stderr. */
  async function orFail<T>(promise: Promise<T>) {
    try {
      return await Promise.race([promise, failed.promise]);
    } catch (e) {
      throw new Error(`${(e as Error).message}\n--- dev server stderr ---\n${dev.stderr()}`, { cause: e });
    }
  }

  // The ids of the frames that the server published to the socket since its
  // last SetUrl reply.
  let published: string[] = [];
  const replies: ((published: string[]) => void)[] = [];
  using hmr = await connectHmr(
    port,
    id => {
      if (id === "V") return;
      if (id !== "n") return void published.push(id);
      replies.shift()?.(published);
      published = [];
    },
    err => failed.reject(err),
  );

  // The server answers SetUrl (`n` plus a route) on the same socket, and only
  // when the route changes, so the round trips alternate between two routes.
  // The reply arrives after each frame that the server published to the
  // socket before it handled the SetUrl frame.
  let route = "/";
  function roundTrip() {
    route = route === "/" ? "/other" : "/";
    const reply = new Promise<string[]>(resolve => replies.push(resolve));
    hmr.ws.send("n" + route);
    return orFail(reply);
  }

  const delivered: { topics: string; ids: string[] }[] = [];
  for (const { topics, page } of steps) {
    hmr.ws.send("s" + topics);
    // Frames that arrive before this reply belong to the previous topic set.
    await roundTrip();
    await orFail(fetch(`http://127.0.0.1:${port}${page}`).then(response => response.text()));
    delivered.push({ topics, ids: [...new Set(await roundTrip())].sort() });
  }
  expect(delivered).toEqual([
    { topics: "hr", ids: ["r", "u"] },
    { topics: "r", ids: ["r"] },
    { topics: "", ids: [] },
    { topics: "hr", ids: ["r", "u"] },
  ]);
});

// Only canary and debug builds have the memory visualizer topic.
test.concurrent.skipIf(!isDebug && !Bun.version_with_sha.includes("-canary"))(
  "the memory visualizer topic sends a frame every second until the socket closes",
  async () => {
    using dir = tempDir("hmr-socket-memory-visualizer", {
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

    // Subscribing sends the first frame. The timer sends the rest.
    let frames = 0;
    const third = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const hmr = await connectHmr(
      port,
      id => void (id === "M" && ++frames === 3 && third.resolve()),
      err => (third.reject(err), closed.resolve()),
    );
    hmr.ws.send("sM");
    await third.promise;
    hmr.ws.close();
    await closed.promise;

    const res = await fetch(`http://127.0.0.1:${port}/fallback`);
    expect(await res.text(), dev.stderr()).toBe("fallback");
  },
);

// The dev server holds the file event of a file that a save emptied, and a timer is one of the
// things that end the hold. `bun --hot` runs no timers after an uncaught error, so it ends every hold then.
test.concurrent(
  "a save in place reaches the page of a dev server under --hot, also after an uncaught error",
  async () => {
    using dir = tempDir("hmr-hold-under-hot", {
      "index.html": indexHtml,
      "entry.ts": `import { text } from "./text.ts";\nconsole.log(text);\nimport.meta.hot.accept();`,
      "text.ts": `export const text = "t0";`,
      "server.ts": /* ts */ `
      import html from "./index.html";
      const server = Bun.serve({
        port: 0,
        development: { hmr: true, console: false },
        routes: {
          "/": html,
          // Leaves a rejection that nothing handles.
          "/boom": () => {
            Promise.reject(new Error("boom"));
            return new Response("sent");
          },
        },
      });
      console.log("PORT=" + server.port);
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "server.ts"],
      // Longer than this test keeps the file empty.
      env: { ...bunEnv, BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS: "30000" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const dev = watchDevServer(proc);
    const port = await dev.port;
    const origin = `http://127.0.0.1:${port}`;

    // The dev server watches text.ts once a page has it.
    const html = await (await fetch(origin + "/")).text();
    for (const [, src] of html.matchAll(/src="([^"]+)"/g)) await (await fetch(new URL(src, origin))).text();

    // `r` frames with code 5: the dev server holds a file event. `u` frames: a hot update.
    let held = 0;
    const updates: string[] = [];
    using hmr = await connectHmr(
      port,
      (id, body) => {
        if (id === "r" && body[0] === 5) held++;
        if (id === "u")
          updates.push(
            Buffer.from(body)
              .toString("latin1")
              .match(/"(t\d)"/)?.[1] ?? "empty",
          );
      },
      () => {},
    );
    hmr.ws.send("n/");
    hmr.ws.send("shr");

    const until = async (what: string, done: () => boolean) => {
      const deadline = Date.now() + 30_000;
      while (!done()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}\n${dev.stderr()}`);
        await Bun.sleep(5);
      }
    };
    /** Empties text.ts, writes `text` once the dev server has reacted, and returns the hot updates of the save. */
    const saveInPlace = async (text: string) => {
      const before = { held, updates: updates.length };
      const fd = openSync(join(String(dir), "text.ts"), "w");
      try {
        // The dev server holds the file event, or it bundles the empty file. On kqueue it does
        // neither: a truncation is no file event there.
        const deadline = Date.now() + (isMacOS ? 250 : 30_000);
        while (held === before.held && updates.length === before.updates && Date.now() < deadline) await Bun.sleep(1);
        writeSync(fd, `export const text = "${text}";`);
      } finally {
        closeSync(fd);
      }
      await until(`the update with ${text}`, () => updates.includes(text));
      return updates.slice(before.updates);
    };

    expect(await saveInPlace("t1")).toEqual(["t1"]);

    await (await fetch(origin + "/boom")).text();
    await until("the uncaught error", () => dev.stderr().includes("boom"));
    // No timer can end a hold now, so no hold lasts. The text still reaches the page.
    expect((await saveInPlace("t2")).at(-1)).toBe("t2");
  },
);

/** Starts `server.ts` under `bun --hot`. `waitMs` is the deadline of a hold. */
function spawnHotServer(dir: string, waitMs: number) {
  return Bun.spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "server.ts"],
    env: { ...bunEnv, BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS: String(waitMs) },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
}
/** Loads the page, so that the dev server watches its files, and records the frames of the HMR socket. */
async function openPage(proc: Subprocess<"ignore", "pipe", "pipe">) {
  const dev = watchDevServer(proc);
  const port = await dev.port;
  const origin = `http://127.0.0.1:${port}`;
  const html = await (await fetch(origin + "/")).text();
  for (const [, src] of html.matchAll(/src="([^"]+)"/g)) await (await fetch(new URL(src, origin))).text();

  // r5: the dev server holds a file event. r6: the hold ended. u: a hot update. e: the errors of a bundle.
  const frames: string[] = [];
  const hmr = await connectHmr(
    port,
    (id, body) => void frames.push(id === "r" ? id + body[0] : id),
    () => {},
  );
  const until = async (what: string, done: () => boolean) => {
    const deadline = Date.now() + 30_000;
    while (!done()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${what}. Frames: ${frames.join(" ")}\n${dev.stderr()}`);
      await Bun.sleep(5);
    }
  };
  // The reply to SetUrl comes after the dev server has handled the Subscribe frame before it.
  hmr.ws.send("sher");
  hmr.ws.send("n/");
  await until("the subscription", () => frames.includes("n"));
  return { hmr, origin, frames, until, stderr: dev.stderr };
}
/** Every watcher reports a delete. kqueue does not report a truncation. */
function emptyOrDelete(path: string) {
  if (isMacOS) unlinkSync(path);
  else closeSync(openSync(path, "w"));
}
const hotServer = (sharedImport: string) => /* ts */ `
  import html from "./index.html";
  ${sharedImport}
  const server = Bun.serve({
    port: 0,
    development: { hmr: true, console: false },
    routes: {
      "/": html,
      // Leaves a rejection that nothing handles.
      "/boom": () => {
        Promise.reject(new Error("boom"));
        return new Response("sent");
      },
    },
  });
  console.log("PORT=" + server.port);
`;

test.concurrent("a hold that is open when an uncaught error happens under --hot ends", async () => {
  using dir = tempDir("hmr-hold-open-at-error", {
    "index.html": indexHtml,
    // Only the page has module.ts, so its file event reloads nothing under --hot.
    "entry.ts": `import "./module.ts";`,
    "module.ts": `console.log("m0");\nimport.meta.hot.accept();`,
    "server.ts": hotServer(""),
  });
  // Longer than the test: the deadline does not end this hold.
  await using proc = spawnHotServer(String(dir), 30_000);
  const dev = await openPage(proc);
  using hmr = dev.hmr;

  emptyOrDelete(join(String(dir), "module.ts"));
  await dev.until("the hold", () => dev.frames.includes("r5"));
  expect(dev.frames).not.toContain("r6");

  await (await fetch(dev.origin + "/boom")).text();
  // No file event follows. The run loop ends the hold when it stops to run timers.
  await dev.until("the end of the hold", () => dev.frames.includes("r6"));
  await dev.until("the page to learn of the save", () => dev.frames.includes("u") || dev.frames.includes("e"));
  expect(dev.stderr()).toContain("boom");
});

test.concurrent("a save that empties a module of the server and of the page under --hot reaches the page", async () => {
  using dir = tempDir("hmr-hold-shared-module", {
    "index.html": indexHtml,
    "entry.ts": `import { shared } from "./module.ts";\nconsole.log(shared);\nimport.meta.hot.accept();`,
    "module.ts": `export const shared = "s0";`,
    // The save fails the reload of the server: the export is gone.
    "server.ts": hotServer(`import { shared } from "./module.ts";\n  console.log(shared);`),
  });
  await using proc = spawnHotServer(String(dir), 30_000);
  const dev = await openPage(proc);
  using hmr = dev.hmr;

  emptyOrDelete(join(String(dir), "module.ts"));
  // No file event follows, and the failed reload stops the timers.
  await dev.until("the page to learn of the save", () => dev.frames.includes("u") || dev.frames.includes("e"));
});

test.concurrent("a hold that ends while a testing batch is open puts its files in the batch", async () => {
  using dir = tempDir("hmr-hold-into-batch", {
    "index.html": indexHtml,
    "entry.ts": `import "./module.ts";`,
    "module.ts": `console.log("m0");\nimport.meta.hot.accept();`,
    "server.ts": serverTs,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: { ...bunEnv, BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS: "300" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const dev = watchDevServer(proc);
  const port = await dev.port;
  const origin = `http://127.0.0.1:${port}`;
  const html = await (await fetch(origin + "/")).text();
  for (const [, src] of html.matchAll(/src="([^"]+)"/g)) await (await fetch(new URL(src, origin))).text();

  // The testing-synchronization codes, in order: 0 batch started, 1 the batch saw files,
  // 3/4 a bundle finished, 5 a file event is held, 6 the hold ended.
  const codes: number[] = [];
  let subscribed = false;
  using hmr = await connectHmr(
    port,
    (id, body) => {
      if (id === "n") subscribed = true;
      if (id === "r") codes.push(body[0]);
    },
    () => {},
  );
  const until = async (what: string, done: () => boolean) => {
    const deadline = Date.now() + 30_000;
    while (!done()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Codes: ${codes}\n${dev.stderr()}`);
      await Bun.sleep(5);
    }
  };
  // The reply to SetUrl comes after the dev server has handled the Subscribe frame before it.
  hmr.ws.send("sr");
  hmr.ws.send("n/");
  await until("the subscription", () => subscribed);

  emptyOrDelete(join(String(dir), "module.ts"));
  await until("the hold", () => codes.includes(5));
  hmr.ws.send("H");
  await until("the batch", () => codes.includes(0));
  // The hold ends at its deadline. Its files wait for the end of the batch, as a file event does.
  await until("the files of the hold in the batch", () => codes.includes(6) && codes.includes(1));
  expect(codes.filter(code => code === 3 || code === 4)).toEqual([]);

  hmr.ws.send("H");
  await until("the bundle of the batch", () => codes.includes(3) || codes.includes(4));
});

test.concurrent("a file event that waited behind a bundle does not take a hold out of a testing batch", async () => {
  // The first request for `/two` parks a bundle in the plugin until this server answers.
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
  using dir = tempDir("hmr-hold-batch-waiting-event", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": holdPlugin,
    "index.html": indexHtml,
    "entry.ts": `import "./module.ts";\nimport "./other.ts";`,
    "module.ts": `console.log("m0");\nimport.meta.hot.accept();`,
    "other.ts": `console.log("o0");\nimport.meta.hot.accept();`,
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
  // A trace inside the project would report its own writes.
  using traceDir = tempDir("hmr-hold-batch-waiting-event-trace", {});
  const trace = join(String(traceDir), "watcher-trace");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: {
      ...bunEnv,
      HMR_TEST_BUNDLE_GATE: String(gate.url),
      BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS: "1000",
      BUN_WATCHER_TRACE: trace,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const dev = watchDevServer(proc);
  const port = await dev.port;
  const origin = `http://127.0.0.1:${port}`;
  const html = await (await fetch(origin + "/")).text();
  for (const [, src] of html.matchAll(/src="([^"]+)"/g)) await (await fetch(new URL(src, origin))).text();

  // The testing-synchronization codes, in order: 0 batch started, 1 the batch saw files, 2 the batch
  // was empty, 3/4 a bundle finished, 5 a file event is held, 6 the hold ended.
  const codes: number[] = [];
  let subscribed = false;
  using hmr = await connectHmr(
    port,
    (id, body) => {
      if (id === "n") subscribed = true;
      if (id === "r") codes.push(body[0]);
    },
    () => {},
  );
  const until = async (what: string, done: () => boolean) => {
    const deadline = Date.now() + 30_000;
    while (!done()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Codes: ${codes}\n${dev.stderr()}`);
      await Bun.sleep(5);
    }
  };
  // The reply to SetUrl comes after the dev server has handled the Subscribe frame before it.
  hmr.ws.send("sr");
  hmr.ws.send("n/");
  await until("the subscription", () => subscribed);

  emptyOrDelete(join(String(dir), "module.ts"));
  await until("the hold", () => codes.includes(5));
  const twoFetch = fetch(origin + "/two");
  twoFetch.catch(() => {});
  await bundleEntered.promise;
  // The batch opens when the bundle ends.
  hmr.ws.send("H");
  writeFileSync(join(String(dir), "other.ts"), `console.log("o1");\nimport.meta.hot.accept();`);
  await until(
    "the watcher to report other.ts",
    () => existsSync(trace) && readFileSync(trace, "latin1").includes("other.ts"),
  );
  // The deadline of the hold passes while the bundle runs.
  await Bun.sleep(1100);
  expect(codes).not.toContain(6);

  // The file event that waited is bundled at once, as without a hold. The hold ends after that, in the batch.
  bundleRelease.resolve();
  await until("the files of the hold in the batch", () => codes.includes(0) && codes.includes(6) && codes.includes(1));
  const before = codes.length;
  hmr.ws.send("H");
  await until("the end of the batch", () => codes.slice(before).some(code => code === 2 || code === 3 || code === 4));
  // Not an empty batch.
  expect(codes.slice(before)).not.toContain(2);
  expect((await twoFetch).status).toBe(200);
});
