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
import { bunEnv, bunExe, isWindows } from "harness";
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
  const newView = () => new Bun.WebView({ backend, width: 100, height: 100 });
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

test.concurrent("the browser exiting rejects what it owed, and the next WebView respawns it", async () => {
  const result = await runScenario(`
    const first = newView();
    await first.navigate("http://fake/1");
    const death = await outcome(first.evaluate("__fake_exit(3)"));
    // Construction fails until the old process has been reaped; retry.
    let second;
    for (;;) {
      try {
        second = newView();
        break;
      } catch (e) {
        if (!/Failed to spawn Chrome/.test(e.message)) throw e;
        await Bun.sleep(1);
      }
    }
    await second.navigate("http://fake/2");
    print({ death, second: await second.evaluate("'alive again'") });
    second.close();
  `);
  expect(result).toEqual({ death: transportLost, second: "alive again" });
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
