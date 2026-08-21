import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");
// The React fixtures live in their own package pinned to react 19 +
// react-reconciler; installed from its lockfile before they run.
const reactApp = join(import.meta.dir, "react-app");

type FixtureResult = {
  /** One entry per JSON line the fixture printed. */
  events: Record<string, any>[];
  /** The fixture could not load the AppKit frameworks and bailed out. */
  skipped: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

async function runFixture(
  name: string,
  opts: { timeoutMs?: number; cwd?: string; args?: string[]; expectFailure?: boolean } = {},
): Promise<FixtureResult> {
  const cwd = opts.cwd ?? fixtures;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(cwd, name), ...(opts.args ?? [])],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeoutMs ?? 10_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout.split("\n").filter(Boolean);
  const skipped = lines.includes("SKIP no-window-server");
  if (skipped) {
    console.warn(`${name}: AppKit could not be loaded here, assertions skipped`);
    expect(exitCode).toBe(0);
  } else if (exitCode !== 0 && !opts.expectFailure) {
    // Surface the fixture's own error ahead of the assertion that is about to fail.
    console.error(`${name} exited with ${exitCode ?? proc.signalCode}\n${stderr}`);
  }
  const events = lines.filter(l => l.startsWith("{")).map(l => JSON.parse(l));
  return { events, skipped, stdout, stderr, exitCode, signal: proc.signalCode };
}

const step = (r: FixtureResult, name: string) => r.events.find(e => e.step === name);

test.skipIf(isMacOS)("bun:appkit is macOS-only elsewhere", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try { await import("bun:appkit"); console.log("imported"); } catch (e) { console.log("threw: " + e.message); }
       try { Bun.AppKit; console.log("got Bun.AppKit"); } catch (e) { console.log("threw: " + e.message); }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.trim().split("\n");
  expect(lines[0]).toMatch(/threw: .*only available on macOS/);
  expect(lines[1]).toMatch(/threw: .*only available on macOS/);
  expect(exitCode).toBe(0);
});

describe.skipIf(!isMacOS)("Bun.AppKit", () => {
  test.concurrent("Bun.AppKit is the bun:appkit namespace", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ns = await import("bun:appkit");
         console.log(JSON.stringify({ same: Bun.AppKit.Window === ns.Window && Bun.AppKit.app === ns.app, keys: ["app","Window","VStack","Text","Button","TextField","Table"].map(k => typeof ns[k]) }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim(), stderr).toStartWith("{");
    expect(JSON.parse(stdout.trim())).toEqual({
      same: true,
      keys: ["object", "function", "function", "function", "function", "function", "function"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("window + views: props round-trip, layout gives frames, closing the last window exits", async () => {
    const r = await runFixture("window-views.ts");
    if (r.skipped) return;
    expect(step(r, "props")).toEqual({
      step: "props",
      text: "World",
      tooltip: "tip",
      buttonTitle: "Go",
      buttonEnabled: false,
      fieldValue: "typed",
      sliderValue: 7.5,
      windowTitle: "retitled",
      children: 4,
      parentIsStack: true,
      windowOfText: true,
      windows: 1,
      visible: true,
    });
    const layout = step(r, "layout");
    expect(layout).toBeDefined();
    expect(layout.button.width).toBeGreaterThan(0);
    expect(layout.button.height).toBeGreaterThan(0);
    expect(layout.text.height).toBeGreaterThan(0);
    // A hugging child (the button) must not pull the window in from the size it was given.
    expect(layout.window).toEqual([300, 200]);
    expect(layout.text.width).toBeGreaterThan(layout.button.width);
    // grow back to 0/null, or leaving a SplitView, must lay out exactly as if neither ever applied.
    const restored = step(r, "priorities restored");
    expect(restored, r.stderr).toBeDefined();
    expect(restored.text[0]).toBeGreaterThan(restored.button[0]);
    // A vertical divider stretches to the 48pt row; a collapsed one is a dot.
    expect(restored.divider[0]).toBeGreaterThanOrEqual(48);
    expect(restored).toEqual({
      step: "priorities restored",
      text: [restored.text[0], restored.text[0], restored.text[0]],
      button: [restored.button[0], restored.button[0]],
      divider: [restored.divider[0], restored.divider[0], restored.divider[0]],
    });
    const split = step(r, "split spacer");
    expect(split, r.stderr).toBeDefined();
    expect(split.spacer).toBeGreaterThanOrEqual(300);
    expect(split.split).toBeGreaterThanOrEqual(300);
    expect(step(r, "split spacer turned").spacer.height).toBeGreaterThanOrEqual(300);
    expect(step(r, "zstack order")).toEqual({
      step: "zstack order",
      children: ["red", "blue"],
      reorderChangesPixels: true,
      restoredMatchesOriginal: true,
    });
    expect(step(r, "onClose")).toBeDefined();
    expect(step(r, "closed")).toEqual({ step: "closed", closed: true, windows: 0 });
    expect(step(r, "unexpected-timer")).toBeUndefined();
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("event loop: timers, fetch, Worker and spawn keep working while a window is open", async () => {
    const r = await runFixture("event-loop.ts");
    if (r.skipped) return;
    const timer = step(r, "timer");
    expect(timer).toBeDefined();
    expect(timer.elapsed).toBeGreaterThanOrEqual(19);
    expect(timer.elapsed).toBeLessThan(150);
    expect(step(r, "fetch")).toEqual({ step: "fetch", body: "served", status: 200 });
    expect(step(r, "worker")).toEqual({ step: "worker", message: "pong" });
    expect(step(r, "spawn")).toEqual({ step: "spawn", stdout: "child", exitCode: 0 });
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("Button.click() fires onClick exactly once and the window snapshots as PNG", async () => {
    const r = await runFixture("button-click.ts");
    if (r.skipped) return;
    expect(step(r, "clicked")).toEqual({ step: "clicked", count: 1, text: "Count: 1" });
    expect(step(r, "cleared")).toEqual({ step: "cleared", count: 1 });
    const snap = step(r, "snapshot");
    expect(snap.isPng).toBe(true);
    expect(snap.windowBytes).toBeGreaterThan(100);
    expect(snap.viewBytes).toBeGreaterThan(0);
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("programmatic value/checked setters do not fire onChange", async () => {
    const r = await runFixture("textfield-setter.ts");
    if (r.skipped) return;
    expect(step(r, "set")).toEqual({
      step: "set",
      events: [],
      fieldValue: "hello",
      editorValue: "multi\nline",
      sliderValue: 0.5,
      checked: true,
    });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent(
    "Picker and Segmented: selectedIndex defaults, duplicate titles, out-of-range and prop order",
    async () => {
      const r = await runFixture("picker.ts");
      if (r.skipped) return;
      expect(step(r, "defaults"), r.stderr).toEqual({ step: "defaults", picker: 0, segmented: 0 });
      // A duplicate title must keep its own slot so indexes line up with items[].
      expect(step(r, "duplicate titles")).toEqual({
        step: "duplicate titles",
        picker: 2,
        segmented: 2,
        items: ["A", "B", "A"],
      });
      expect(step(r, "index before items")).toEqual({ step: "index before items", before: -1, after: 2 });
      // Same answer whichever prop is applied first, and the wanted index survives until items grow to reach it.
      expect(step(r, "out of range")).toEqual({
        step: "out of range",
        picker: [-1, -1],
        segmented: [-1, -1],
        grown: [5, 5],
      });
      expect(step(r, "none")).toEqual({ step: "none", explicit: -1, reset: 0 });
      expect(step(r, "shrunk")).toEqual({ step: "shrunk", picker: -1, segmented: -1 });
      expect(step(r, "selectedIndex=fraction")).toEqual({ step: "selectedIndex=fraction", picker: 1, segmented: 1 });
      for (const name of ["negative", "huge"]) {
        expect(step(r, `selectedIndex=${name}`)).toEqual({ step: `selectedIndex=${name}`, picker: -1, segmented: -1 });
      }
      expect(step(r, "selectedIndex=NaN")).toEqual({
        step: "selectedIndex=NaN",
        threw: { isTypeError: true, message: "Picker.selectedIndex must be a finite number" },
      });
      expect(step(r, "selectedIndex=string")).toEqual({
        step: "selectedIndex=string",
        threw: { isTypeError: true, message: "Picker.selectedIndex must be a number or null" },
      });
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent("unparented views are garbage collected", async () => {
    const r = await runFixture("gc-views.ts");
    if (r.skipped) return;
    const created = step(r, "created");
    expect(created.live).toBeGreaterThanOrEqual(created.baseline + 300);
    const collected = step(r, "collected");
    expect(collected.after).toBeLessThanOrEqual(collected.baseline + 5);
    expect(r.exitCode).toBe(0);
  });

  test.concurrent(
    "app.keepAlive holds the process after the last window closes, and releasing it lets it exit",
    async () => {
      const r = await runFixture("keep-alive.ts", { timeoutMs: 5_000 });
      if (r.skipped) return;
      expect(step(r, "closed")).toEqual({ step: "closed", closed: true, windows: 0, keepAlive: true });
      expect(step(r, "still-alive")).toBeDefined();
      expect(step(r, "unexpected-timer")).toBeUndefined();
      // A SIGKILL here means keepAlive = false did not release the process.
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent("ScrollView scrollBars: a horizontal scroller lets the document keep its width", async () => {
    const r = await runFixture("scroll-view.ts");
    if (r.skipped) return;
    const both = step(r, "both");
    expect(both, r.stderr).toBeDefined();
    // The window keeps the size it was given; the document scrolls instead of pushing it wider.
    expect(both.window).toBe(200);
    expect(both.document).toBeGreaterThan(2 * both.scroll);
    const vertical = step(r, "vertical");
    expect(vertical.window).toBe(200);
    expect(vertical.document).toBeLessThanOrEqual(vertical.scroll + 8);
    const again = step(r, "both again");
    expect(again.document).toBeGreaterThan(2 * again.scroll);
    expect(step(r, "vstack align")).toEqual({
      step: "vstack align",
      align: "bottom",
      threw: { isTypeError: true, message: expect.stringContaining("horizontal stack") },
    });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("a Worker that touches AppKit first is refused and the main thread still works", async () => {
    const r = await runFixture("wrong-thread.ts");
    const worker = step(r, "worker");
    expect(worker, r.stderr).toBeDefined();
    // The thread check runs before the frameworks are loaded, so this holds even where they cannot load.
    expect(worker.view).toMatchObject({ threw: true, message: expect.stringMatching(/main thread/) });
    expect(worker.start).toMatchObject({ threw: true, message: expect.stringMatching(/main thread/) });
    expect(worker.window).toMatchObject({ threw: true });
    if (r.skipped) return;
    expect(step(r, "main")).toEqual({ step: "main", windows: 1 });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("bad prop values throw TypeErrors that name the prop; misuse of the tree throws", async () => {
    const r = await runFixture("errors.ts");
    if (r.skipped) return;
    for (const [name, prop] of [
      ["slider.value=string", "value"],
      ["text.lineLimit=object", "lineLimit"],
      ["button.kind=bogus", "kind"],
    ] as const) {
      const e = step(r, name);
      expect(e).toMatchObject({ step: name, threw: true, isTypeError: true });
      expect(e.message).toContain(prop);
    }
    expect(step(r, "text.background=badcolor")).toMatchObject({ threw: true });
    expect(step(r, "text.background=badcolor").message).toMatch(/colou?r/i);
    expect(step(r, "text.background=rgb(nan)")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "text.background=rgb(nan)").message).toMatch(/colou?r/i);
    expect(step(r, "slider.step=-1")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "slider.step=-1").message).toMatch(/positive/);
    expect(step(r, "text.font.size=Infinity")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "text.font.size=Infinity").message).toMatch(/positive/);
    expect(step(r, "abstract View")).toMatchObject({ threw: true });
    expect(step(r, "method as prop")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "method as prop").message).toBe('Unknown property "click" for Button');
    expect(step(r, "unregistered prop")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "unregistered prop").message).toBe('Unknown property "kind" for Text');
    expect(step(r, "getter as prop")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "getter as prop").message).toBe('Unknown property "frame" for Text');
    expect(step(r, "subclass props")).toEqual({ step: "subclass props", threw: false });
    expect(step(r, "append twice")).toMatchObject({ threw: true });
    expect(step(r, "append twice").message).toMatch(/parent/i);
    expect(step(r, "removeChild stranger")).toMatchObject({ threw: true });
    expect(step(r, "valid props")).toEqual({ step: "valid props", threw: false });
    expect(step(r, "window x without y")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window x without y").message).toMatch(/together/);
    expect(step(r, "restoreName after close")).toMatchObject({ threw: false });
    expect(step(r, "window show option")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window show option").message).toBe('Unknown Window option "show"');
    expect(step(r, "unknown window option")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "unknown window option").message).toBe('Unknown Window option "bogus"');
    expect(step(r, "unknown window option leak")).toEqual({ step: "unknown window option leak", leaked: 0 });
    expect(step(r, "window bad handler")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window bad handler").message).toBe("Window.onClose must be a function");
    expect(step(r, "window bad handler leak")).toEqual({ step: "window bad handler leak", leaked: 0 });
    expect(step(r, "window bad content")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window bad content").message).toBe("Window.content must be a View or null");
    expect(step(r, "window bad content leak")).toEqual({ step: "window bad content leak", leaked: 0 });
    expect(step(r, "window width NaN")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window width NaN").message).toMatch(/finite/);
    expect(step(r, "window width NaN leak")).toEqual({ step: "window width NaN leak", leaked: 0 });
    expect(step(r, "window x Infinity")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window x Infinity").message).toMatch(/finite/);
    expect(step(r, "window width 3e9")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window width 3e9").message).toMatch(/Window\.width must be .*no larger than/);
    expect(step(r, "window width 3e9 leak")).toEqual({ step: "window width 3e9 leak", leaked: 0 });
    expect(step(r, "window x 1e15")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window x 1e15").message).toMatch(/Window\.x must be .*no larger than/);
    expect(step(r, "shown text width 3e9")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "shown text width 3e9").message).toMatch(/Text\.width must be .*no larger than/);
    expect(step(r, "window create-only after create")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window create-only after create").message).toMatch(
      /resizable cannot be changed after the window is created/,
    );
    expect(step(r, "window unknown via applyProp")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "window unknown via applyProp").message).toBe('Unknown Window option "bogus"');
    expect(step(r, "hide after close")).toMatchObject({ threw: true });
    expect(step(r, "hide after close").message).toMatch(/closed/);
    expect(step(r, "title after close")).toMatchObject({ threw: true });
    expect(step(r, "content after close")).toMatchObject({ threw: true });
    expect(step(r, "content after close").message).toMatch(/closed/);
    expect(step(r, "content after close state")).toEqual({ step: "content after close state", content: true });
    expect(step(r, "menu action without colon")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "menu action without colon").message).toMatch(/selector/);
    expect(r.exitCode).toBe(0);
  });

  describe("react", () => {
    beforeAll(() => {
      const install = Bun.spawnSync([bunExe(), "install", "--frozen-lockfile"], {
        cwd: reactApp,
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      if (!install.success) throw new Error("bun install failed in " + reactApp);
    });

    test.concurrent("react: Button click updates state and re-renders a Text", async () => {
      const r = await runFixture("react-counter.tsx", { cwd: reactApp });
      if (r.skipped) return;
      expect(step(r, "rendered")).toEqual({ step: "rendered", windows: 1, hasWindow: true });
      expect(step(r, "tree")).toEqual({
        step: "tree",
        kinds: ["Text", "Button"],
        text: "Count: 0",
        title: "0 clicks",
        kind: "primary",
      });
      expect(step(r, "clicked-once")).toEqual({ step: "clicked-once", text: "Count: 1", title: "1 clicks" });
      expect(step(r, "clicked-thrice")).toMatchObject({ step: "clicked-thrice", text: "Count: 3" });
      expect(step(r, "clicked-thrice").snapshotBytes).toBeGreaterThan(100);
      expect(step(r, "unmounted")).toMatchObject({ step: "unmounted", windows: 0 });
      expect(step(r, "unknown-element")).toEqual({
        step: "unknown-element",
        errors: ["Unknown AppKit element <constructor>"],
      });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a rejected render never leaves a native window behind", async () => {
      const r = await runFixture("react-placement.tsx", { cwd: reactApp, timeoutMs: 5_000 });
      if (r.skipped) return;
      // React renders the failing tree twice before giving up; neither attempt may leave a window behind.
      expect(step(r, "nested-window"), r.stderr).toEqual({
        step: "nested-window",
        errors: [expect.stringMatching(/<Window> must be rendered at the root, not inside <VStack>/)],
        windows: 0,
      });
      expect(step(r, "view-at-root")).toEqual({
        step: "view-at-root",
        errors: [expect.stringMatching(/<VStack> must be inside a <Window>/)],
        windows: 0,
      });
      expect(step(r, "window-then-view-at-root")).toEqual({
        step: "window-then-view-at-root",
        errors: [expect.stringMatching(/<VStack> must be inside a <Window>/)],
        windows: 0,
      });
      expect(step(r, "sibling-throws")).toEqual({ step: "sibling-throws", errors: ["boom"], windows: 0 });
      expect(step(r, "two-children")).toEqual({
        step: "two-children",
        errors: [expect.stringMatching(/<Window> accepts a single child/)],
        windows: 0,
      });
      expect(step(r, "title-and-children")).toEqual({
        step: "title-and-children",
        errors: [expect.stringMatching(/either as the title prop or as children/)],
        windows: 0,
      });
      expect(step(r, "text-source")).toEqual({
        step: "text-source",
        errors: [],
        titles: ["from-children", "from-prop", "xy", "", "from-prop-again", "nothing-rendered"],
      });
      expect(step(r, "titled-group")).toEqual({
        step: "titled-group",
        errors: [],
        titles: ["first", "second"],
        kinds: ["VStack", "Text"],
      });
      // A leaked hidden window would keep the process alive until the SIGKILL timeout.
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: keyed children reorder, replace, hide and empty in place", async () => {
      const r = await runFixture("react-reorder.tsx", { cwd: reactApp });
      if (r.skipped) return;
      expect(step(r, "initial")).toEqual({ step: "initial", order: ["a", "b", "c", "d"] });
      expect(step(r, "reordered")).toEqual({ step: "reordered", order: ["d", "a", "c", "b"] });
      expect(step(r, "replaced")).toEqual({
        step: "replaced",
        order: ["c", "btn", "e", "a"],
        kinds: ["Text", "Button", "Text", "Text"],
      });
      expect(step(r, "hidden")).toEqual({ step: "hidden", hidden: [false, false, false, true] });
      expect(step(r, "emptied")).toEqual({ step: "emptied", order: [] });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a user-closed <Window> keeps taking updates without tearing down the root", async () => {
      const r = await runFixture("react-closed-window.tsx", { cwd: reactApp });
      if (r.skipped) return;
      expect(step(r, "rerender"), r.stderr).toEqual({
        step: "rerender",
        errors: [],
        mainClosed: false,
        mainTitle: "main 1",
        panelClosed: true,
      });
      expect(step(r, "toggle-visible")).toEqual({ step: "toggle-visible", errors: [], mainClosed: false });
      expect(step(r, "unmounted")).toEqual({ step: "unmounted", errors: [], windows: 0 });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a render error without onError is an uncaught exception", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, expectFailure: true });
      if (r.skipped) return;
      expect(r.stderr).toContain("error: boom");
      expect(r.exitCode).toBe(1);
    });

    test.concurrent("react: a render error with onError goes to the handler and the process exits 0", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, args: ["handled"] });
      if (r.skipped) return;
      expect(step(r, "after-render"), r.stderr).toEqual({
        step: "after-render",
        errors: ["boom"],
        windows: 0,
        text: null,
      });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a render error React recovers from is logged, not fatal", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, args: ["flaky"] });
      if (r.skipped) return;
      expect(step(r, "after-render"), r.stderr).toEqual({ step: "after-render", errors: [], windows: 1, text: "ok" });
      expect(r.stderr).toContain("React was able to recover");
      expect(r.exitCode).toBe(0);
    });
  });
});
