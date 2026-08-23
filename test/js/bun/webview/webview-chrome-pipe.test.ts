// The spawn-mode transport (Chrome's --remote-debugging-pipe: commands on the
// child's fd 3, replies on fd 4; one socketpair on POSIX, two pipes driven by
// libuv on Windows) exercised without a browser: fake-chrome-fixture.ts is
// spawned in Chrome's place, so this runs on every platform, including CI
// agents that cannot start a real browser. webview-chrome.test.ts covers the
// real thing where one is installed.
//
// Each scenario runs in its own bun process because the transport is a
// process-wide singleton and several scenarios destroy it on purpose. A
// scenario prints one JSON value; `outcome()` turns a promise into
// { resolved } or { rejected: message }.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fake-chrome-fixture.ts");

// Same bytes fake-chrome-fixture.ts returns for Page.captureScreenshot.
const SCREENSHOT_BYTES = Buffer.alloc(100_000);
for (let i = 0; i < SCREENSHOT_BYTES.length; i++) SCREENSHOT_BYTES[i] = (i * 7) & 0xff;

// 300 KB of varying content, several times the transport's read buffer; built
// from this expression on whichever side needs it rather than passed around,
// since scenarios travel on the command line.
const BIG = "Array.from({ length: 300000 }, (_, i) => i % 10).join('')";

const prelude = /* js */ `
  const backend = {
    type: "chrome",
    url: false,
    path: ${JSON.stringify(bunExe())},
    argv: [${JSON.stringify(fixture)}],
    stderr: "inherit",
  };
  const newView = (overrides = {}) => new Bun.WebView({ backend: { ...backend, ...overrides }, width: 100, height: 100 });
  const outcome = promise => promise.then(resolved => ({ resolved }), e => ({ rejected: e.message }));
  const print = value => console.log(JSON.stringify(value));
  const big = ${BIG};
`;

async function runScenario(body: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// Whichever of the two notifications (the pipe breaking, the process exit)
// the event loop sees first decides the message.
const transportLost = {
  rejected: expect.stringMatching(/^Chrome (process closed the pipe|exited|killed by signal \d+)$/),
};

test.concurrent("navigate, events and evaluate cross the pipes", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/page");
    const value = await view.evaluate("({ answer: 6 * 7, text: 'from the fake' })");
    const undef = typeof (await view.evaluate("undefined"));
    print({ url: view.url, title: view.title, value, undef });
    view.close();
  `);
  expect(result).toEqual({
    url: "http://fake/page",
    title: "fake chrome",
    value: { answer: 42, text: "from the fake" },
    undef: "undefined",
  });
});

test.concurrent("a reply larger than the read buffer is reassembled", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const value = await view.evaluate(${JSON.stringify(BIG)});
    print({ length: value.length, equal: value === big });
    view.close();
  `);
  expect(result).toEqual({ length: 300000, equal: true });
});

test.concurrent("a command larger than one write arrives whole", async () => {
  // The fake compares the 300 KB literal it received with a copy it builds itself.
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await view.evaluate(JSON.stringify(big) + " === " + ${JSON.stringify(BIG)}));
    view.close();
  `);
  expect(result).toBe(true);
});

test.concurrent("screenshot bytes survive the trip back", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const blob = await view.screenshot();
    const bytes = Buffer.from(await blob.arrayBuffer());
    print({ type: blob.type, size: bytes.length, hash: String(Bun.hash(bytes)) });
    view.close();
  `);
  expect(result).toEqual({
    type: "image/png",
    size: SCREENSHOT_BYTES.length,
    hash: String(Bun.hash(SCREENSHOT_BYTES)),
  });
});

test.concurrent("many views interleave their commands on the one transport", async () => {
  const result = await runScenario(`
    const views = Array.from({ length: 8 }, newView);
    await Promise.all(views.map((view, i) => view.navigate("http://fake/" + i)));
    const values = await Promise.all(views.map((view, i) => view.evaluate(String(i * 100))));
    print({ urls: views.map(view => view.url), values });
    for (const view of views) view.close();
  `);
  expect(result).toEqual({
    urls: Array.from({ length: 8 }, (_, i) => "http://fake/" + i),
    values: Array.from({ length: 8 }, (_, i) => i * 100),
  });
});

test.concurrent("an expression that throws rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await outcome(view.evaluate("(() => { throw new Error('inside the fake'); })()")));
    view.close();
  `);
  expect(result).toEqual({ rejected: expect.stringContaining("inside the fake") });
});

// Once the loss has been reported, the old process is no longer in the way:
// the next WebView spawns without waiting for it to be reaped.
test.concurrent("the browser exiting rejects what it owed, and the next WebView respawns it", async () => {
  const result = await runScenario(`
    const first = newView();
    await first.navigate("http://fake/1");
    const death = await outcome(first.evaluate("__fake_exit(3)"));
    const second = newView();
    await second.navigate("http://fake/2");
    print({ death, second: await second.evaluate("'alive again'") });
    second.close();
  `);
  expect(result).toEqual({ death: transportLost, second: "alive again" });
});

// closeAll() closes every view and kills the browser at once. The fake would
// outlive its pipes by 20 s, so the next WebView only spawns in the same tick
// if closeAll() let go of the old process itself.
test.concurrent("closeAll() rejects what is pending and the next WebView spawns at once", async () => {
  const result = await runScenario(`
    const first = newView({ argv: [${JSON.stringify(fixture)}, "--exit-delay=20000"] });
    await first.navigate("http://fake/1");
    const pending = outcome(first.evaluate("__fake_no_reply()"));
    Bun.WebView.closeAll();
    let afterClose;
    try {
      first.evaluate("1");
      afterClose = "accepted";
    } catch (e) {
      afterClose = e.code;
    }
    const second = newView();
    await second.navigate("http://fake/2");
    print({ pending: await pending, afterClose, second: await second.evaluate("'alive again'") });
    second.close();
  `);
  expect(result).toEqual({
    pending: { rejected: "WebView closed by WebView.closeAll()" },
    afterClose: "ERR_INVALID_STATE",
    second: "alive again",
  });
});

// `bun test --isolate` replaces the global object between files. The transport
// is bound to the global that spawned the browser, so it has to go with that
// file: its open views are closed, their pending promises rejected, and the
// next file spawns a browser of its own. The fake outlives its pipes by 20 s
// like a real browser shutting down, so the next file cannot depend on the
// old process having gone away by itself.
test.concurrent("bun test --isolate retires the transport with the file that spawned it", async () => {
  const file = /* js */ `
    import { test } from "bun:test";
    const backend = {
      type: "chrome",
      url: false,
      path: ${JSON.stringify(bunExe())},
      argv: [${JSON.stringify(fixture)}, "--exit-delay=20000"],
      stderr: "inherit",
    };
    test("leaves a view open with a command in flight", async () => {
      const view = new Bun.WebView({ backend, width: 100, height: 100 });
      await view.navigate("http://fake/" + import.meta.file);
      console.log(JSON.stringify({ file: import.meta.file, url: view.url }));
      view.evaluate("__fake_no_reply()").catch(e => {
        // Runs while the file's global is being retired: no new browser may bind to it.
        let late;
        try {
          new Bun.WebView({ backend, width: 100, height: 100 });
          late = "created";
        } catch (err) {
          late = err.code;
        }
        console.log(JSON.stringify({ file: import.meta.file, rejected: e.message, isError: e instanceof Error, late }));
      });
    });
  `;
  using dir = tempDir("webview-isolate", { "a.test.ts": file, "b.test.ts": file });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.ts", "b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The first stdout line is the `bun test` banner.
  const lines = stdout
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line));
  // The first file's evaluate is rejected when its global retires; the second
  // file's is still in flight when the run ends. Discovery order decides
  // which file is which.
  const [first, second] = lines[0]?.file === "b.test.ts" ? ["b.test.ts", "a.test.ts"] : ["a.test.ts", "b.test.ts"];
  expect(lines).toEqual([
    { file: first, url: "http://fake/" + first },
    { file: first, rejected: "WebView closed: its test file finished", isError: true, late: "ERR_INVALID_STATE" },
    { file: second, url: "http://fake/" + second },
  ]);
  expect(stderr).toContain(" 2 pass");
  expect(exitCode).toBe(0);
});

// On POSIX fd 3 and fd 4 are one socket, so losing a single direction is not
// a state that exists there; on Windows they are two pipes with two failure
// modes of their own.
const windowsOnly = isWindows ? test.concurrent : test.skip;

windowsOnly("the reply pipe closing while the process lives rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    print(await outcome(view.evaluate("__fake_close_replies()")));
  `);
  expect(result).toEqual({ rejected: "Chrome process closed the pipe" });
});

windowsOnly("a write to a command pipe nobody reads any more rejects", async () => {
  const result = await runScenario(`
    const view = newView();
    await view.navigate("http://fake/");
    const closing = await outcome(view.evaluate("__fake_close_commands()"));
    const next = await outcome(view.evaluate("1"));
    print({ closing, next });
  `);
  expect(result).toEqual({ closing: {}, next: { rejected: "Chrome process closed the pipe" } });
});
