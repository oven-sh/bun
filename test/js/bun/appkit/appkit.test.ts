import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS } from "harness";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");
// The React fixtures need React 19 while test/ pins React 18, so
// test/package.json carries react, react-reconciler and scheduler under alias
// names and beforeAll copies them into react-app/node_modules under their real
// names. Nothing is fetched at test time.
const reactApp = join(import.meta.dir, "react-app");
const reactModules: [alias: string, name: string][] = [
  ["react-19", "react"],
  ["react-reconciler-19", "react-reconciler"],
  ["scheduler-0.27", "scheduler"],
];

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

test.skipIf(isMacOS)("off macOS bun:appkit is not a builtin and Bun.AppKit is absent", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { isBuiltin, builtinModules } = require("node:module");
       const result = {};
       for (const id of ["bun:appkit", "bun:appkit/react"]) {
         const importError = await import(id).then(() => null, e => e);
         let resolveError = null;
         try { require.resolve(id); } catch (e) { resolveError = e; }
         result[id] = {
           importError: importError && { name: importError.constructor.name, code: importError.code },
           resolveError: resolveError && resolveError.code,
           getBuiltinModule: typeof process.getBuiltinModule(id),
           isBuiltin: isBuiltin(id),
           listed: builtinModules.includes(id),
         };
       }
       result.hasKey = "AppKit" in Bun;
       result.type = typeof Bun.AppKit;
       console.log(JSON.stringify(result));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim(), stderr).toStartWith("{");
  const notABuiltin = {
    importError: { name: "ResolveMessage", code: "ERR_MODULE_NOT_FOUND" },
    resolveError: "MODULE_NOT_FOUND",
    getBuiltinModule: "undefined",
    isBuiltin: false,
    listed: false,
  };
  expect(JSON.parse(stdout.trim())).toEqual({
    "bun:appkit": notABuiltin,
    "bun:appkit/react": notABuiltin,
    hasKey: false,
    type: "undefined",
  });
  expect(exitCode).toBe(0);
});

describe.skipIf(!isMacOS)("Bun.AppKit", () => {
  test.concurrent(
    "every Objective-C binding and delegate method compiled in matches the frameworks on this machine",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `require("bun:appkit");
           const { appKitInternals } = require("bun:internal-for-testing");
           console.log(JSON.stringify(appKitInternals.verifyBindings()));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // One line per selector missing on this macOS, wrong integer width, BOOL or struct layout.
      expect(JSON.parse(stdout.trim() || "null"), stderr).toEqual([]);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("Bun.AppKit is the bun:appkit namespace", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ns = await import("bun:appkit");
         console.log(JSON.stringify({ same: Bun.AppKit.Window === ns.Window && Bun.AppKit.app === ns.app, keys: ["app","Window","VStack","Text","Button","TextField","Table","MetalView","gpu","objc"].map(k => typeof ns[k]) }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim(), stderr).toStartWith("{");
    expect(JSON.parse(stdout.trim())).toEqual({
      same: true,
      keys: [
        "object",
        "function",
        "function",
        "function",
        "function",
        "function",
        "function",
        "function",
        "object",
        "object",
      ],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("reading app (including by reflection) never starts the application", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { app } = require("bun:appkit");
         const copy = { ...app };
         JSON.stringify(app);
         console.log(JSON.stringify({
           hasDisplay: typeof app.hasDisplay,
           isDark: app.isDark,
           name: app.name,
           renamed: (app.name = "Tool", app.name),
           reset: (app.name = null, app.name),
           badge: (app.badge = 3, app.badge),
           copied: typeof copy.hasDisplay,
           liveViews: "liveViews" in app,
           dunder: Object.keys(require("bun:appkit")).filter(k => k.startsWith("__")),
           running: app.isRunning,
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (stderr.includes("ERR_APPKIT_UNAVAILABLE")) return;
    expect(stdout.trim(), stderr).toStartWith("{");
    const name = basename(bunExe());
    expect(JSON.parse(stdout.trim())).toEqual({
      hasDisplay: "boolean",
      isDark: false,
      name,
      renamed: "Tool",
      reset: name,
      badge: "3",
      copied: "boolean",
      liveViews: false,
      dunder: [],
      running: false,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "the runtime surface matches appkit.d.ts and unset props read as their documented defaults",
    async () => {
      const r = await runFixture("surface.ts");
      if (r.skipped) return;
      const surface = step(r, "surface");
      expect(surface, r.stderr).toBeDefined();
      const declared = declaredSurface();
      // Every accessor and method on a class's prototype chain is declared, and back.
      for (const [name, { members }] of Object.entries<{ members: Record<string, string> }>(surface.classes)) {
        const want = declared.classes[name];
        expect(want, `class ${name} is exported at runtime but not declared`).toBeDefined();
        expect({ class: name, members: Object.keys(members).sort() }).toEqual({
          class: name,
          members: [...want.members].sort(),
        });
      }
      for (const name of Object.keys(declared.classes)) {
        if (declared.classes[name].isView || name === "Window") expect(surface.classes[name], name).toBeDefined();
      }
      expect(Object.keys(surface.app).sort()).toEqual([...declared.app].sort());
      expect(surface.namespace.filter((k: string) => k !== "default").sort()).toEqual([...declared.exports].sort());
      // Getters of unset props answer the @default written in the .d.ts.
      const mismatches: string[] = [];
      let compared = 0;
      for (const [name, { defaults }] of Object.entries<{ defaults: Record<string, unknown> }>(surface.classes)) {
        const documented = declared.classes[name]?.defaults ?? {};
        for (const [prop, want] of Object.entries(documented)) {
          if (!(prop in defaults)) continue;
          compared++;
          if (!Bun.deepEquals(defaults[prop], want)) {
            mismatches.push(
              `${name}.${prop}: runtime ${JSON.stringify(defaults[prop])}, d.ts @default ${JSON.stringify(want)}`,
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(compared).toBeGreaterThan(60);
      expect(surface.reset).toEqual({ lineLimit: 1, spacing: 8 });
      expect(surface.instanceOf).toEqual({ secureField: true, searchField: true, textFieldIsSecure: false });
      expect(r.exitCode).toBe(0);
    },
  );

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

  test.concurrent(
    "layout: frames are current, groups wrap children, windows keep their limits, grow shares space",
    async () => {
      const r = await runFixture("layout.ts");
      if (r.skipped) return;
      // `frame` lays out first: a child appended a moment ago has a size, and a longer text is wider at once.
      const frame = step(r, "frame");
      expect(frame, r.stderr).toBeDefined();
      expect(frame.detached).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(frame.appended).toBeGreaterThan(10);
      expect(frame.grown).toBeGreaterThan(frame.appended);
      // Content taller than the window grew it; the onResize that caused ran
      // after the getter returned, once, and could read frames itself.
      expect(frame.height).toBeGreaterThan(300);
      expect(frame.events).toEqual(["appended", "resize", "nested:true", "read"]);
      // A Group is as tall as its two stacked buttons plus padding (and title), no more, and spans the stack.
      const group = step(r, "group");
      expect(group.a.height).toBeGreaterThan(0);
      expect(group.bare.height).toBeGreaterThan(group.a.height + group.b.height);
      expect(group.bare.height).toBeLessThan(120);
      expect(group.titled.height).toBeGreaterThan(group.bare.height);
      expect(group.titled.height).toBeLessThan(150);
      expect(Math.abs(group.a.y - group.b.y)).toBeGreaterThanOrEqual(group.b.height);
      expect(group.titled.width).toBe(group.stack.width);
      // Long titles truncate; the 300pt window stays 300pt.
      expect(step(r, "long labels")).toEqual({
        step: "long labels",
        widths: { button: 300, checkbox: 300, picker: 300, segmented: 300, text: 300, row: 300 },
      });
      expect(step(r, "tall content")).toEqual({
        step: "tall content",
        grown: [300, 500],
        kept: [300, 120],
        cappedSize: [400, 200, 400],
        setPastMax: 400,
        afterLowerMax: 350,
      });
      expect(step(r, "min max")).toEqual({
        step: "min max",
        minOverMax: 200,
        maxThenMin: 200,
        widthUnderMin: 100,
        widthOverMax: 120,
        maxCleared: 300,
      });
      const grow = step(r, "grow");
      expect(Math.abs(grow.centred.left - grow.centred.right)).toBeLessThanOrEqual(1);
      expect(grow.centred.left).toBeGreaterThan(50);
      expect(Math.abs(grow.centred.labelMid - grow.centred.rowWidth / 2)).toBeLessThanOrEqual(1);
      expect(grow.ratio.one).toBeGreaterThan(50);
      expect(Math.abs(grow.ratio.two - 2 * grow.ratio.one)).toBeLessThanOrEqual(2);
      expect(Math.round(grow.ratio.one + grow.ratio.two + grow.ratio.fixed)).toBe(340);
      expect(Math.abs(grow.nested.equal[0] - grow.nested.equal[1])).toBeLessThanOrEqual(1);
      expect(Math.round(grow.nested.equal[0] + grow.nested.equal[1])).toBe(300);
      expect(Math.abs(grow.nested.reweighted[1] - 2 * grow.nested.reweighted[0])).toBeLessThanOrEqual(2);
      expect(grow.nested.hidden).toBe(300);
      expect(Math.abs(grow.nested.restored[0] - grow.nested.restored[1])).toBeLessThanOrEqual(1);
      // The growing pane takes the 200pt the window gained; the other keeps its width.
      const split = step(r, "split grow");
      expect(split.after[1] - split.before[1]).toBeGreaterThanOrEqual(190);
      expect(Math.abs(split.after[0] - split.before[0])).toBeLessThanOrEqual(10);
      // Vertical in the 48pt row unless told otherwise, horizontal again once moved to the column.
      const divider = step(r, "divider");
      expect(divider.inRow.auto.height).toBeGreaterThanOrEqual(48);
      expect(divider.inRow.auto.width).toBeLessThan(10);
      expect(divider.inRow.flat.height).toBeLessThan(10);
      expect(divider.inColumn.height).toBeLessThan(10);
      expect(divider.inColumn.width).toBeGreaterThan(48);
      expect(step(r, "progress order")).toEqual({ step: "progress order", sameAsMaxFirst: true, sameAsHalf: false });
      expect(step(r, "click").message).toContain("click()");
      expect(step(r, "done")).toBeDefined();
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent(
    "event loop: timers, fetch, Worker and spawn keep working while a window is open; idle costs no CPU and a cross-thread wake is prompt",
    async () => {
      const r = await runFixture("event-loop.ts");
      if (r.skipped) return;
      const timer = step(r, "timer");
      expect(timer, r.stderr).toBeDefined();
      expect(timer.elapsed).toBeGreaterThanOrEqual(19);
      expect(timer.elapsed).toBeLessThan(150);
      // Parked in AppKit for ~500 ms with nothing to do: a busy loop would burn most of that.
      const idle = step(r, "idle");
      expect(idle.wallMs).toBeGreaterThanOrEqual(490);
      expect(idle.cpuMs).toBeLessThan(idle.wallMs * (isDebug || isASAN ? 0.5 : 0.25));
      // Twenty postMessage round trips with no timer or server pending on the main thread;
      // a lost wake would sit until the fixture is killed.
      const worker = step(r, "worker");
      expect(worker).toEqual({ step: "worker", message: "pong", rounds: 20, worstMs: expect.any(Number) });
      expect(worker.worstMs).toBeLessThan(isDebug || isASAN ? 1000 : 250);
      expect(step(r, "fetch")).toEqual({ step: "fetch", body: "served", status: 200 });
      expect(step(r, "spawn")).toEqual({ step: "spawn", stdout: "child", exitCode: 0 });
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent(
    "event loop: timers armed by JavaScript that AppKit runs inside its wait fire on time; a synchronous wait there is serviced",
    async () => {
      const r = await runFixture("wait.ts");
      if (r.skipped) return;
      const inside = step(r, "inside-wait");
      expect(inside, r.stderr).toMatchObject({ step: "inside-wait", immediate: true });
      expect(inside.timerMs).toBeLessThan(isDebug || isASAN ? 1000 : 250);
      expect(step(r, "sync-wait")).toEqual({ step: "sync-wait", before: 0, during0: 1, resolved: 1, after: 1 });
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent("Radio: siblings in one container act as a group; separate containers do not", async () => {
    const r = await runFixture("radio.ts");
    if (r.skipped) return;
    expect(step(r, "set A"), r.stderr).toEqual({ step: "set A", a: true, b: false, c: false, events: [] });
    // AppKit clears A itself; only the clicked radio reports a change.
    expect(step(r, "click B")).toEqual({ step: "click B", a: false, b: true, c: false, events: ["B:true"] });
    expect(step(r, "set C")).toEqual({ step: "set C", a: false, b: false, c: true, events: [] });
    expect(step(r, "separate containers")).toEqual({
      step: "separate containers",
      x: true,
      y: true,
      events: ["Y:true"],
    });
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
    "text field events fired from inside a container or window change reach handlers that re-enter it",
    async () => {
      const r = await runFixture("textfield-reentrancy.ts");
      if (r.skipped) return;
      // onBlur runs once the removal has settled, before removeChild() returns,
      // and everything it did to the container and the field stuck.
      expect(step(r, "remove while editing"), r.stderr).toEqual({
        step: "remove while editing",
        log: ["blur", "appended", "removed"],
        children: ["Button", "Text"],
        spacing: 3,
        value: "edited from onBlur",
      });
      // Editing that a setter ends is still reported (it is not the setter's echo).
      expect(step(r, "hide while editing")).toEqual({ step: "hide while editing", log: ["blur", "hidden set"] });
      expect(step(r, "replace content while editing")).toEqual({
        step: "replace content while editing",
        log: ["blur", "width=number", "replaced"],
        title: "blurred",
        content: ["Text"],
      });
      // A same-parent insertBefore is a move: the field never leaves the window, so no blur until it is removed.
      expect(step(r, "reorder keeps focus")).toEqual({
        step: "reorder keeps focus",
        log: [],
        afterMoveToEnd: ["Button", "Button", "TextField"],
        afterMoveToFront: ["TextField", "Button", "Button"],
        afterSiblingMove: ["TextField", "Button", "Button"],
        framesAscend: true,
      });
      expect(step(r, "reorder then remove")).toEqual({ step: "reorder then remove", log: ["blur"] });
      expect(step(r, "zstack reorder")).toEqual({
        step: "zstack reorder",
        children: ["TextField", "Text"],
        sameFrame: true,
      });
      // Like view setters, window geometry setters do not echo into onResize/onMove.
      expect(step(r, "window setters")).toEqual({ step: "window setters", events: [], width: 320, height: 240 });
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent("Table: columns, rows, selection, prop order and collection", async () => {
    const r = await runFixture("table.ts");
    if (r.skipped) return;
    const mounted = step(r, "mounted");
    expect(mounted, r.stderr).toMatchObject({ step: "mounted", isPng: true, selected: [], headerVisible: null });
    expect(mounted.frame.width).toBeGreaterThan(100);
    expect(mounted.frame.height).toBeGreaterThan(100);
    const selection = step(r, "selection");
    expect(selection).toMatchObject({ step: "selection", single: [1], multi: [0, 2], selectEvents: [] });
    // Turning `multiple` off keeps exactly one of the rows that were selected.
    expect(selection.trimmed).toHaveLength(1);
    expect([0, 2]).toContain(selection.trimmed[0]);
    expect(step(r, "rows")).toEqual({
      step: "rows",
      beforeGrow: [],
      afterGrow: [4],
      afterShrink: [],
      selectEvents: [],
    });
    const ragged = step(r, "ragged");
    expect(ragged.snapshot).toBe(true);
    expect(ragged.frame.width).toBeGreaterThan(100);
    expect(step(r, "many rows")).toEqual({ step: "many rows", selected: [19_999], snapshot: true });
    const collected = step(r, "collected");
    expect(collected.after).toBeLessThanOrEqual(collected.baseline + 5);
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
      // keepAlive = true starts the application by itself, before any window exists.
      expect(step(r, "started"), r.stderr).toEqual({ step: "started", running: true });
      expect(step(r, "closed")).toEqual({ step: "closed", closed: true, windows: 0, keepAlive: true });
      expect(step(r, "still-alive")).toBeDefined();
      expect(step(r, "unexpected-timer")).toBeUndefined();
      // A SIGKILL here means keepAlive = false did not release the process.
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

  test.concurrent(
    "app.quit(): beforequit and shouldClose can veto; otherwise every window closes, 'exit' runs and the process ends despite keepAlive and a timer",
    async () => {
      const r = await runFixture("quit.ts", { timeoutMs: 5_000, expectFailure: true });
      if (r.skipped) return;
      const open = [false, false, false];
      expect(step(r, "preventDefault"), r.stderr).toEqual({ step: "preventDefault", closed: open });
      expect(step(r, "return-false")).toEqual({ step: "return-false", closed: open });
      // A throwing listener is reported and does not hide another listener's veto, in either order.
      expect(step(r, "prevent-then-throw")).toEqual({
        step: "prevent-then-throw",
        closed: open,
        uncaught: ["listener boom"],
      });
      expect(step(r, "throw-then-prevent")).toEqual({
        step: "throw-then-prevent",
        closed: open,
        uncaught: ["listener boom"],
      });
      // Windows are asked in creation order and closed as they agree; the first refusal stops the quit.
      expect(step(r, "shouldClose-false")).toEqual({
        step: "shouldClose-false",
        closed: [true, false, false],
        onClose: 1,
        shouldCloseCalls: 1,
        order: ["main", "palette"],
      });
      // Every window closed, hidden and non-closable ones included; a second
      // quit after the accepted one does not ask beforequit again; the throw
      // from the accepted quit's listener was reported once.
      expect(step(r, "exit")).toEqual({
        step: "exit",
        closed: [true, true, true],
        code: 3,
        onClose: 3,
        shouldCloseCalls: 1,
        lateCalls: 0,
        uncaught: ["listener boom"],
      });
      // The exit happens at the next turn of the loop, not inside quit().
      expect(step(r, "after-quit")).toMatchObject({ step: "after-quit", closed: [true, true, true], lateCalls: 0 });
      expect(step(r, "beforeExit")).toBeUndefined();
      // A SIGKILL here means the quit left the process running.
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(3);
    },
  );

  test.concurrent(
    "-[NSApplication terminate:] (Quit menu item, Dock, logout) takes the same path and exits in place",
    async () => {
      const r = await runFixture("quit.ts", { timeoutMs: 5_000, args: ["terminate"], expectFailure: true });
      if (r.skipped) return;
      expect(step(r, "shouldClose-false"), r.stderr).toMatchObject({ closed: [true, false, false] });
      expect(step(r, "exit")).toEqual({
        step: "exit",
        closed: [true, true, true],
        code: 3,
        onClose: 3,
        shouldCloseCalls: 1,
        lateCalls: 0,
        uncaught: ["listener boom"],
      });
      // AppKit exits before terminate: returns.
      expect(step(r, "unreachable")).toBeUndefined();
      expect(step(r, "beforeExit")).toBeUndefined();
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(3);
    },
  );

  test.concurrent("an uncaught NSException names itself before the crash report", async () => {
    const r = await runFixture("objc-exception.ts", { timeoutMs: 10_000, expectFailure: true });
    if (r.skipped) return;
    expect(r.stdout).not.toContain("not reached");
    expect(r.stderr).toContain("uncaught Objective-C exception BunTestException: raised on purpose");
    expect(r.exitCode).not.toBe(0);
  });

  test.concurrent("app.quit() with no window open ends a process that only keepAlive started and holds", async () => {
    const r = await runFixture("quit.ts", { timeoutMs: 5_000, args: ["no-windows"] });
    if (r.skipped) return;
    expect(step(r, "exit"), r.stderr).toEqual({ step: "exit", closed: [], code: 0, running: true });
    expect(step(r, "after-quit")).toEqual({ step: "after-quit", closed: [] });
    expect(step(r, "beforeExit")).toBeUndefined();
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("app.quit() before anything started AppKit is process.exit(process.exitCode)", async () => {
    const r = await runFixture("quit.ts", { timeoutMs: 5_000, args: ["not-started"], expectFailure: true });
    if (r.skipped) return;
    expect(step(r, "exit"), r.stderr).toEqual({ step: "exit", closed: [], code: 4, running: false });
    expect(step(r, "after-quit")).toBeUndefined();
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(4);
  });

  test.concurrent(
    "app.quit() with only windows holding the process exits through process.exit, not by draining",
    async () => {
      const r = await runFixture("quit.ts", { timeoutMs: 5_000, args: ["plain"], expectFailure: true });
      if (r.skipped) return;
      expect(step(r, "exit"), r.stderr).toEqual({ step: "exit", closed: [true, true, true], code: 5, onClose: 3 });
      expect(step(r, "after-quit")).toMatchObject({ step: "after-quit", closed: [true, true, true] });
      expect(step(r, "beforeExit")).toBeUndefined();
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(5);
    },
  );

  test.concurrent("process.exit() inside a callback AppKit is running exits with that code", async () => {
    const r = await runFixture("quit.ts", { timeoutMs: 5_000, args: ["exit-in-shouldClose"], expectFailure: true });
    if (r.skipped) return;
    expect(step(r, "unreachable"), r.stderr).toBeUndefined();
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(7);
  });

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
    const refused = { threw: true, message: expect.stringMatching(/main thread/) };
    expect(worker.view).toMatchObject(refused);
    expect(worker.start).toMatchObject(refused);
    // A refused start is not remembered as a start: the next call is refused the same way.
    expect(worker.window).toMatchObject(refused);
    expect(worker.keepAlive).toMatchObject(refused);
    expect({ running: worker.running, keptAlive: worker.keptAlive }).toEqual({ running: false, keptAlive: false });
    if (r.skipped) return;
    expect(step(r, "main")).toEqual({ step: "main", windows: 1 });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent(
    "objc: classes and selectors by name, conversion by type encoding, ownership, .native, and the errors",
    async () => {
      const r = await runFixture("objc-bridge.ts");
      // The thread check comes first, so a Worker is refused even where the frameworks cannot load.
      const refused = { threw: true, message: expect.stringMatching(/main thread/) };
      expect(step(r, "worker"), r.stderr).toMatchObject({ lookup: refused, ns: refused, sel: { threw: false } });
      if (r.skipped) return;
      expect(step(r, "nsstring"), r.stderr).toEqual({
        step: "nsstring",
        length: 2,
        utf8: "hi",
        template: "hi",
        string: "hi",
        description: "hi",
        js: "hi",
        memoized: true,
        tag: "[object ObjCObject]",
        classTag: "[object ObjCClass]",
        className: "NSString",
        sameClass: true,
        pointer: "bigint",
        classPointer: "bigint",
        isEqual: true,
        hasPrefix: false,
        unicode: "héllo",
        unicodeLength: 5,
        thenable: "undefined",
        resolvesToItself: true,
      });
      expect(step(r, "array")).toEqual({
        step: "array",
        count: 2,
        second: "there",
        firstIsS: true,
        addReturns: "undefined",
        js: ["hi", "there"],
        isKindOfArray: true,
        isKindOfString: false,
        classIsSubclass: true,
        superclassShared: true,
        respondsToCount: true,
        respondsToSel: true,
        respondsToNope: false,
        instancesRespond: true,
        selName: "terminate:",
        selString: "terminate:",
      });
      expect(step(r, "processName")).toEqual({ step: "processName", type: "string", matchesExecutable: true });
      expect(step(r, "conversion")).toEqual({
        step: "conversion",
        intValue: 3,
        doubleValue: 2.5,
        floatValue: 2.5,
        boolValue: true,
        longLong: -5,
        unsignedLongLong: "18446744073709551615",
        unsignedLongLongType: "bigint",
        jsNumber: 3,
        jsDouble: 2.5,
        jsBool: true,
        jsString: "s",
        jsStrings: ["a", "b"],
        jsNested: { a: 1, b: [true, null, "s"] },
        jsPassthrough: [7, "x", null, true],
        nsNull: null,
        nsUndefined: null,
        nsHandle: true,
        nsArrayCount: 3,
        nsDictLookup: "v",
        nilReturn: null,
        json: '{"s":"hi","strings":["a","b"],"n":4}',
        jsonPlain: expect.stringMatching(/^<NSObject: 0x[0-9a-f]+>$/),
        range: { location: 6, length: 5 },
        notFound: "9223372036854775807",
        notFoundType: "bigint",
        substring: "hello",
        bigRange: "9223372036854775807",
        badRange: true,
        loneSurrogate: true,
        loneSurrogateLength: 3,
        // A selector only fits a SEL argument; anywhere else it is refused like any other class instance.
        selectorForId: { threw: true, isTypeError: true, message: expect.stringContaining("ObjCSelector") },
        nsSelector: { threw: true, isTypeError: true, message: expect.stringContaining("ObjCSelector") },
        classesProbes: { then: "undefined", string: "[objc.classes]", json: '{"c":"[objc.classes]"}', awaited: true },
      });
      // SEL arguments take a string or objc.sel(); SEL results are strings.
      expect(step(r, "selectors")).toEqual({ step: "selectors", fromString: "terminate:", fromSel: "hide:" });
      expect(step(r, "view")).toEqual({
        step: "view",
        frame: { origin: { x: 1, y: 2 }, size: { width: 30, height: 40 } },
        flat: { origin: { x: 5, y: 6 }, size: { width: 70, height: 80 } },
        moved: { origin: { x: 3, y: 4 }, size: { width: 50, height: 60 } },
        identity: true,
        isView: true,
        isWindow: false,
        vstackIsStackView: true,
        tableOuter: "NSScrollView",
        tableDocument: true,
        scrollInsets: { top: 0, left: 0, bottom: 0, right: 0 },
      });
      // Changes made through the NSWindow show in the curated getters, which read the live object.
      expect(step(r, "window")).toEqual({
        step: "window",
        titleBefore: "t",
        titleAfter: "u",
        isVisible: false,
        frameKeys: ["origin", "size"],
        frameWidth: 300,
        frameAtLeastContentHeight: true,
        widthAfterNested: 320,
        widthAfterFlat: 340,
        nativeFrameWidth: 340,
        identity: true,
        isWindow: true,
        contentViewIsView: true,
        sameThroughContentView: true,
        samePointer: true,
        sameDifferent: false,
        sameNulls: false,
        sameStrings: false,
      });
      const badState = { threw: true, isTypeError: false, code: "ERR_INVALID_STATE" };
      expect(step(r, "native after close")).toMatchObject(badState);
      expect(step(r, "native after close").message).toMatch(/closed/);
      expect(step(r, "handle after close")).toEqual({ step: "handle after close", title: "u" });
      const typeError = { threw: true, isTypeError: true };
      expect(step(r, "unknown class")).toEqual({
        step: "unknown class",
        ...typeError,
        message: 'objc: no class named "NSDefinitelyNotAClass"',
      });
      // Checked with respondsToSelector: before sending, so no NSException.
      expect(step(r, "unrecognized selector")).toMatchObject(typeError);
      expect(step(r, "unrecognized selector").message).toMatch(/definitelyNotASelector:\]: unrecognized selector/);
      expect(step(r, "unrecognized class selector")).toMatchObject(typeError);
      expect(step(r, "unrecognized class selector").message).toContain(
        "+[NSString definitelyNot]: unrecognized selector",
      );
      expect(step(r, "wrong arg count")).toMatchObject(typeError);
      expect(step(r, "wrong arg count").message).toMatch(/compare:.*"compare_".*1 argument.*0 were passed/);
      expect(step(r, "wrong arg count extra")).toMatchObject(typeError);
      expect(step(r, "wrong arg count extra").message).toMatch(/length\]: "length".*0 arguments.*1 was passed/);
      expect(step(r, "wrong arg count msgSend")).toMatchObject(typeError);
      expect(step(r, "wrong arg count msgSend").message).toContain("compare:");
      expect(step(r, "msgSend works")).toEqual({ step: "msgSend works", threw: false, value: 0 });
      expect(step(r, "block arg")).toMatchObject(typeError);
      expect(step(r, "block arg").message).toMatch(/block.*not supported yet/i);
      expect(step(r, "pointer arg")).toMatchObject(typeError);
      expect(step(r, "pointer arg").message).toMatch(/pointer/i);
      for (const name of ["fractional index", "negative unsigned", "string for number", "symbol for object"]) {
        expect(step(r, name)).toMatchObject({ step: name, ...typeError });
      }
      expect(step(r, "fractional index").message).toContain("removeObjectAtIndex:");
      expect(step(r, "bad struct")).toMatchObject(typeError);
      expect(step(r, "bad struct").message).toMatch(/setFrame:.*(origin, size|\.y)/);
      expect(step(r, "assign property")).toMatchObject(typeError);
      expect(step(r, "bad msgSend selector")).toMatchObject(typeError);
      expect(step(r, "bad sel")).toMatchObject(typeError);
      for (const name of ["retainCount refused", "retain refused"]) {
        expect(step(r, name)).toMatchObject({
          step: name,
          ...typeError,
          message: expect.stringMatching(/release\(\)/),
        });
      }
      for (const name of ["variadic format", "variadic objects", "variadic append", "variadic init"]) {
        expect(step(r, name)).toMatchObject({ step: name, ...typeError, message: expect.stringMatching(/variadic/) });
      }
      expect(step(r, "va_list")).toMatchObject({ ...typeError, message: expect.stringMatching(/va_list/) });
      expect(step(r, "object arguments:")).toEqual({ step: "object arguments:", threw: false, value: "sum:" });
      expect(step(r, "non-variadic format")).toEqual({
        step: "non-variadic format",
        threw: false,
        value: 'SELF == "a"',
      });
      for (const name of ["init on class", "init on class msgSend"]) {
        expect(step(r, name)).toMatchObject({ step: name, ...typeError, message: expect.stringMatching(/alloc\(\)/) });
      }
      expect(step(r, "alloc then bad init")).toMatchObject(typeError);
      expect(step(r, "alloc then bad init").message).toMatch(/-\[NSButton initWithFrame:\]: argument 0/);
      expect(step(r, "alloc then wrong count")).toMatchObject(typeError);
      expect(step(r, "alloc then wrong count").message).toContain("initWithFrame:");
      const notInitialized = { ...typeError, message: expect.stringMatching(/came from alloc\(\).*init/) };
      for (const name of ["alloc then not init", "alloc toString", "alloc json", "alloc as argument"]) {
        expect(step(r, name)).toMatchObject({ step: name, ...notInitialized });
      }
      expect(step(r, "alloc")).toEqual({
        step: "alloc",
        pointer: "0",
        sameAsItself: true,
        sameAsOther: false,
        thenInit: 0,
        consumed: { threw: true, isTypeError: true, message: expect.stringMatching(/consumed by init/) },
      });
      // A View or Window where an object is expected names `.native`; other class instances are not dictionaries.
      expect(step(r, "view for id")).toMatchObject({ ...typeError, message: expect.stringMatching(/view\.native/) });
      expect(step(r, "window for id")).toMatchObject({
        ...typeError,
        message: expect.stringMatching(/window\.native/),
      });
      expect(step(r, "class instance for id")).toMatchObject({
        ...typeError,
        message: expect.stringMatching(/cannot convert an object/),
      });
      expect(step(r, "null-proto object for id")).toEqual({ step: "null-proto object for id", threw: false, value: 0 });
      expect(step(r, "date for id")).toMatchObject(typeError);
      for (const name of ["NUL in char*", "NUL in SEL"]) {
        expect(step(r, name)).toMatchObject({ step: name, ...typeError, message: expect.stringMatching(/NUL/) });
      }
      expect(step(r, "2^60 for Q")).toMatchObject({ ...typeError, message: expect.stringMatching(/bigint/) });
      // None of the refused calls above was sent.
      expect(step(r, "still two")).toEqual({ step: "still two", count: 2 });
      // alloc/new results are taken over, +0 returns retained once per handle, init consumes its receiver.
      const ownership = step(r, "ownership");
      expect(ownership).toEqual({
        step: "ownership",
        consumed: { threw: true, isTypeError: true, message: expect.stringMatching(/consumed by init/) },
        owned: "x0",
        heldBeforeRelease: true,
        releasedNow: true,
        useAfterRelease: {
          threw: true,
          isTypeError: false,
          code: "ERR_INVALID_STATE",
          message: expect.stringMatching(/released/),
        },
        // A released handle is still itself but no longer any object.
        sameAfterRelease: [true, false],
        stillInArray: "NSObject",
        left: true,
      });
      expect(step(r, "done")).toEqual({ step: "done", length: 2, count: 2 });
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    },
  );

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
    expect(step(r, "text.background=rgb(nan)")).toMatchObject({
      threw: true,
      isTypeError: true,
      code: "ERR_INVALID_ARG_VALUE",
    });
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
    // Tree state (wrong parent, not a child) is ERR_INVALID_STATE; a wrong argument is a TypeError.
    const badState = { threw: true, isTypeError: false, code: "ERR_INVALID_STATE" };
    expect(step(r, "append twice")).toMatchObject(badState);
    expect(step(r, "append twice").message).toMatch(/parent/i);
    expect(step(r, "removeChild stranger")).toMatchObject(badState);
    for (const name of [
      "insertBefore stranger ref",
      "insertBefore move stranger ref",
      "replaceChildren foreign child",
    ]) {
      expect(step(r, name)).toMatchObject({ step: name, ...badState });
    }
    for (const name of ["replaceChildren duplicate", "replaceChildren non-view"]) {
      expect(step(r, name)).toMatchObject({ step: name, threw: true, isTypeError: true });
    }
    expect(step(r, "tree after rejected edits")).toEqual({
      step: "tree after rejected edits",
      a: ["x"],
      b: ["first"],
      textParent: true,
      firstParent: true,
    });
    expect(step(r, "image missing file")).toMatchObject({
      threw: true,
      isTypeError: false,
      path: "/definitely/missing.png",
    });
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
    const closedWindow = { threw: true, isTypeError: false, code: "ERR_INVALID_STATE" };
    expect(step(r, "hide after close")).toMatchObject(closedWindow);
    expect(step(r, "hide after close").message).toMatch(/closed/);
    expect(step(r, "title after close")).toMatchObject(closedWindow);
    expect(step(r, "content after close")).toMatchObject(closedWindow);
    expect(step(r, "content after close").message).toMatch(/closed/);
    expect(step(r, "content after close state")).toEqual({ step: "content after close state", content: true });
    expect(step(r, "menu action without colon")).toMatchObject({ threw: true, isTypeError: true });
    expect(step(r, "menu action without colon").message).toMatch(/selector/);
    expect(step(r, "menu action outside the standard list")).toMatchObject({
      threw: true,
      isTypeError: true,
      code: "ERR_INVALID_ARG_VALUE",
    });
    expect(step(r, "menu action outside the standard list").message).toMatch(/not a supported menu action/);
    expect(r.exitCode).toBe(0);
  });

  describe("metal", () => {
    // These need a Metal device. On machines without one (VMs, sandboxes) each fixture prints
    // {step:"skip-no-gpu"} and its GPU assertions are skipped; metal-struct.ts is pure layout
    // arithmetic and always asserts.
    const noGpu = (r: FixtureResult, name: string) => {
      if (!step(r, "skip-no-gpu")) return false;
      console.warn(`${name}: no Metal device here, GPU assertions skipped`);
      expect(r.exitCode).toBe(0);
      return true;
    };

    test.concurrent("gpu.struct lays fields out by MSL rules and packs values", async () => {
      const r = await runFixture("metal-struct.ts");
      if (r.skipped) return;
      expect(step(r, "layout"), r.stderr).toEqual({
        step: "layout",
        offsets: { a: 0, b: 16, c: 32 },
        sizes: { a: 4, b: 16, c: 64 },
        size: 96,
        align: 16,
        msl: "struct Uniforms {\n  float a;\n  float3 b;\n  float4x4 c;\n};",
        name: "Uniforms",
      });
      expect(step(r, "mixed")).toEqual({
        step: "mixed",
        fields: {
          m2: [0, 16, 8],
          h: [16, 2, 2],
          h3: [24, 8, 8],
          u: [32, 4, 4],
          flag: [36, 1, 1],
          m3: [48, 48, 16],
          s: [96, 2, 2],
          i2: [104, 8, 8],
        },
        size: 112,
        align: 16,
        firstLine: "struct Mixed {",
      });
      expect(step(r, "pack")).toEqual({
        step: "pack",
        isArrayBuffer: true,
        byteLength: 96,
        a: 1.5,
        b: [1, 2, 3, 0],
        diagonal: [1, 1, 1, 1],
      });
      expect(step(r, "pack into")).toEqual({ step: "pack into", same: true, before: [7, 7], a: 7, b: [9, 8, 7, 7] });
      expect(step(r, "pack mixed")).toEqual({
        step: "pack mixed",
        h: 0.5,
        h3: [1, 2, 3],
        u: [1, 2, 3, 255],
        flag: 1,
        s: -2,
        i2: [-1, 1],
        m3: [1, 4, 7],
      });
      for (const [name, pattern] of [
        ["unknown type", /"a".*float5/],
        ["no fields", /at least one field/],
        ["bad name", /identifier/],
        ["wrong length", /Uniforms\.b .*3.*float3.*got 2/],
        ["unknown field", /nope/],
        ["scalar as string", /Uniforms\.a must be a number/],
      ] as const) {
        expect(step(r, name)).toMatchObject({ step: name, threw: true, isTypeError: true });
        expect(step(r, name).message).toMatch(pattern);
      }
      expect(step(r, "too small")).toMatchObject({ threw: true, isTypeError: false });
      expect(step(r, "too small").message).toMatch(/do not fit/);
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("offscreen render pass draws a triangle that readPixels sees; errors are typed", async () => {
      const r = await runFixture("metal-triangle.ts");
      if (r.skipped || noGpu(r, "metal-triangle.ts")) return;
      expect(step(r, "device"), r.stderr).toEqual({ step: "device", name: "string", unifiedMemory: "boolean" });
      expect(step(r, "library")).toEqual({ step: "library", names: ["red", "vs"] });
      expect(step(r, "objects")).toEqual({
        step: "objects",
        texture: { width: 64, height: 64, format: "bgra8unorm" },
        pipeline: { colorFormats: ["bgra8unorm"], depthFormat: null },
      });
      // BGRA bytes: the triangle is red, the untouched corner is the blue clear colour.
      expect(step(r, "pixels")).toEqual({
        step: "pixels",
        byteLength: 64 * 64 * 4,
        center: [0, 0, 255, 255],
        corner: [255, 0, 0, 255],
        committed: true,
      });
      expect(step(r, "use after commit")).toMatchObject({ threw: true });
      expect(step(r, "use after commit").message).toMatch(/committed/);
      expect(step(r, "buffer")).toEqual({
        step: "buffer",
        byteLength: 8,
        roundTrip: [1, 2, 3, 4, 5, 6, 7, 8],
        tail: [7, 8],
      });
      expect(step(r, "buffer write out of bounds")).toMatchObject({ threw: true });
      expect(step(r, "compile error")).toMatchObject({
        threw: true,
        name: "GpuCompileError",
        isCompileError: true,
        message: expect.stringMatching(/error/i),
      });
      const missing = step(r, "no such function");
      expect(missing).toMatchObject({ threw: true });
      expect(missing.message).toContain("missing");
      expect(missing.message).toContain("vs");
      expect(step(r, "draw without pipeline")).toMatchObject({ threw: true });
      expect(step(r, "draw without pipeline").message).toMatch(/pipeline/i);
      expect(step(r, "function types")).toEqual({
        step: "function types",
        vs: "vertex",
        red: "fragment",
        noop: "kernel",
      });
      expect(step(r, "after commitAndWait")).toEqual({
        step: "after commitAndWait",
        state: "committed",
        gpuStatus: "completed",
        error: null,
        inFlight: false,
      });
      // BGRA: cleared to green; readPixels waited for the un-waited commit by itself.
      expect(step(r, "commit then read")).toEqual({
        step: "commit then read",
        corner: [0, 255, 0, 255],
        gpuStatus: "completed",
      });
      expect(step(r, "two vertex buffers")).toEqual({ step: "two vertex buffers", center: [0, 255, 0, 255] });
      expect(step(r, "attribute described twice")).toMatchObject({ threw: true, isCompileError: true });
      expect(step(r, "bind offset equal to length")).toMatchObject({ threw: true, isRangeError: true });
      expect(step(r, "bind offset misaligned")).toMatchObject({ threw: true, isTypeError: true });
      expect(step(r, "kernel as vertex function")).toMatchObject({ threw: true, isTypeError: true });
      expect(step(r, "kernel as vertex function").message).toMatch(/vertex/);
      expect(step(r, "vertex function as kernel")).toMatchObject({ threw: true, isTypeError: true });
      expect(step(r, "destroyed")).toEqual({ step: "destroyed", destroyed: true, byteLength: 0 });
      expect(step(r, "write after destroy")).toMatchObject({
        threw: true,
        isTypeError: false,
        code: "ERR_INVALID_STATE",
        message: expect.stringMatching(/destroyed/),
      });
      expect(step(r, "bytesPerRow not whole pixels")).toMatchObject({ threw: true, isTypeError: true });
      expect(step(r, "mipmaps of an integer format")).toMatchObject({ threw: true, isTypeError: true });
      // A few earlier attempts leave frames open until they are collected.
      const limit = step(r, "open frame limit");
      expect(limit.opened).toBeLessThanOrEqual(32);
      expect(limit.opened).toBeGreaterThan(20);
      expect(limit.threw).toMatch(/frames are open/);
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("compute pass doubles a Float32Array in shared and private buffers", async () => {
      const r = await runFixture("metal-compute.ts");
      if (r.skipped || noGpu(r, "metal-compute.ts")) return;
      expect(step(r, "pipeline"), r.stderr).toEqual({ step: "pipeline", widthPositive: true, maxAtLeastWidth: true });
      expect(step(r, "doubled")).toEqual({ step: "doubled", values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] });
      expect(step(r, "private")).toEqual({
        step: "private",
        storage: "private",
        values: [20, 40, 60, 80, 100, 120, 140, 160, 180, 200],
      });
      // `buffer` held the doubled values (the x10 pass ran on the private copy); the x0.5 pass was
      // committed without waiting and read() waited for it by itself.
      expect(step(r, "read after commit")).toEqual({
        step: "read after commit",
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        inFlightAfter: false,
      });
      expect(step(r, "managed alias")).toEqual({ step: "managed alias", storage: "shared" });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("MetalView.draw() runs onFrame with a frame and timing info", async () => {
      const r = await runFixture("metal-view.ts");
      if (r.skipped) return;
      const constructed = step(r, "constructed");
      expect(constructed, r.stderr).toMatchObject({ step: "constructed", sameGpu: true, running: false });
      if (!constructed.available) {
        // Without a device the view is a placeholder: it lays out but never produces frames.
        expect(step(r, "no-gpu")).toEqual({ step: "no-gpu", frames: 0, drawableSize: { width: 0, height: 0 } });
        noGpu(r, "metal-view.ts");
        return;
      }
      const frames = step(r, "frames");
      expect(frames).toMatchObject({
        step: "frames",
        count: 2,
        increasing: true,
        firstDt: 0,
        types: [
          ["number", "number", "number", "number"],
          ["number", "number", "number", "number"],
        ],
      });
      expect(frames.passes).toEqual(["ok", "ok"]);
      expect(frames.drawableSize).toEqual({ width: expect.any(Number), height: expect.any(Number) });
      expect(step(r, "cleared")).toEqual({ step: "cleared", count: 2 });
      expect(step(r, "outside onFrame").outside).toEqual({
        message: expect.stringMatching(/onFrame/),
        code: "ERR_INVALID_STATE",
      });
      const thrown = step(r, "thrown handler");
      expect(thrown.dropped).toEqual({ committed: false, state: "dropped" });
      expect(thrown.uncaught).toEqual(["handler failed"]);
      expect(thrown.secondPass).toBe("ok");
      expect(thrown.depthPass).toBe("ok");
      // draw() inside onFrame is refused; the frame in progress carries on and no nested frame ran.
      expect(thrown.nestedDraw).toEqual({ message: expect.stringMatching(/inside/), code: "ERR_INVALID_STATE" });
      expect(thrown.afterNested).toBe("ok");
      expect(thrown.runs).toBe(1);
      expect(r.exitCode).toBe(0);
    });
  });

  describe("react", () => {
    beforeAll(() => {
      for (const [alias, name] of reactModules) {
        const from = dirname(require.resolve(alias));
        const to = join(reactApp, "node_modules", name);
        rmSync(to, { recursive: true, force: true });
        cpSync(from, to, { recursive: true, dereference: true });
      }
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
      // "A" is inserted before the <VStack/> and the <Button/> before the "B" piece:
      // each lands ahead of its anchor among its own kind.
      expect(step(r, "group-anchors")).toEqual({
        step: "group-anchors",
        errors: [],
        before: { title: "B", kinds: ["VStack", "Text"] },
        after: { title: "AB", kinds: ["VStack", "Button", "Text"] },
        restored: { title: "B", kinds: ["VStack", "Text"] },
      });
      // A leaked hidden window would keep the process alive until the SIGKILL timeout.
      expect(r.signal).toBeNull();
      expect(r.exitCode).toBe(0);
    });

    test.concurrent(
      "react: keyed children reorder, replace, hide and empty in place; deleted views are freed",
      async () => {
        const r = await runFixture("react-reorder.tsx", { cwd: reactApp });
        if (r.skipped) return;
        expect(step(r, "initial")).toEqual({ step: "initial", order: ["a", "b", "c", "d"] });
        expect(step(r, "reordered")).toEqual({ step: "reordered", order: ["d", "a", "c", "b"], sameViews: true });
        expect(step(r, "replaced")).toEqual({
          step: "replaced",
          order: ["c", "btn", "e", "a"],
          kinds: ["Text", "Button", "Text", "Text"],
        });
        const freed = {
          text: expect.any(String),
          frame: { x: 0, y: 0, width: 0, height: 0 },
          setter: "ERR_INVALID_STATE",
        };
        expect(step(r, "released"), r.stderr).toEqual({
          step: "released",
          a: false,
          b: freed,
          d: freed,
          liveViewsDelta: 0,
        });
        expect(step(r, "hidden")).toEqual({ step: "hidden", hidden: [false, false, false, true] });
        expect(step(r, "emptied")).toEqual({ step: "emptied", order: [] });
        expect(r.exitCode).toBe(0);
      },
    );

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

    test.concurrent("react: .native of a view React deleted throws; a handle taken earlier keeps working", async () => {
      const r = await runFixture("react-objc-native.tsx", { cwd: reactApp });
      if (r.skipped) return;
      expect(step(r, "released"), r.stderr).toEqual({
        step: "released",
        mounted: { isTextField: true, stringValue: "mounted", identity: true },
        released: true,
        native: { threw: true, code: "ERR_INVALID_STATE", message: "Invalid state: Text has been released" },
        handleStillWorks: "mounted",
        windowNative: { threw: false },
      });
      expect(step(r, "unmounted")).toEqual({
        step: "unmounted",
        windows: 0,
        closedNative: { threw: true, code: "ERR_INVALID_STATE", message: "Invalid state: window is closed" },
      });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a render error with no handlers is an uncaught exception", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, expectFailure: true });
      if (r.skipped) return;
      expect(r.stderr).toContain("error: boom");
      expect(r.exitCode).toBe(1);
    });

    test.concurrent("react: a render error outside any boundary goes to onUncaughtError only", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, args: ["uncaught"] });
      if (r.skipped) return;
      expect(step(r, "after-render"), r.stderr).toEqual({
        step: "after-render",
        uncaught: ["boom"],
        caught: [],
        recoverable: [],
        windows: 0,
        text: null,
      });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("react: a render error under an error boundary goes to onCaughtError only", async () => {
      const r = await runFixture("react-throw.tsx", { cwd: reactApp, args: ["caught"] });
      if (r.skipped) return;
      expect(step(r, "after-render"), r.stderr).toEqual({
        step: "after-render",
        uncaught: [],
        caught: ["boom"],
        recoverable: [],
        windows: 1,
        text: "fallback",
      });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent(
      "react: a render error React recovers from goes to onRecoverableError and is not fatal",
      async () => {
        const r = await runFixture("react-throw.tsx", { cwd: reactApp, args: ["flaky"] });
        if (r.skipped) return;
        const after = step(r, "after-render");
        expect(after, r.stderr).toMatchObject({
          step: "after-render",
          uncaught: [],
          caught: [],
          windows: 1,
          text: "ok",
        });
        expect(after.recoverable).toEqual([expect.stringContaining("React was able to recover")]);
        expect(r.exitCode).toBe(0);
      },
    );

    test.concurrent(
      "react: a bad prop value or a create-only Window option in an update is reported and skipped",
      async () => {
        const r = await runFixture("react-bad-update.tsx", { cwd: reactApp });
        if (r.skipped) return;
        const quiet = { uncaught: [], caught: [], recoverable: [] };
        expect(step(r, "bad-value"), r.stderr).toEqual({
          step: "bad-value",
          ...quiet,
          windows: 2,
          titles: ["main 1", "other 1"],
          texts: [
            { text: "colored 1", background: "red" },
            { text: "sibling 1", background: null },
          ],
        });
        expect(r.stderr).toContain("<Text> background:");
        expect(r.stderr).toContain("The background update was skipped");
        expect(step(r, "create-only")).toEqual({
          step: "create-only",
          ...quiet,
          windows: 2,
          titles: ["main 2", "other 2"],
        });
        expect(r.stderr).toContain("<Window> resizable cannot change after the window is created");
        expect(step(r, "recovered")).toEqual({
          step: "recovered",
          ...quiet,
          windows: 2,
          texts: [
            { text: "colored 3", background: "blue" },
            { text: "sibling 3", background: null },
          ],
        });
        expect(r.exitCode).toBe(0);
      },
    );

    test.concurrent("react: modules hands the renderer the app's own React; every root shares it", async () => {
      const r = await runFixture("react-modules.tsx", { cwd: reactApp });
      if (r.skipped) return;
      expect(step(r, "modules"), r.stderr).toEqual({
        step: "modules",
        early: "early",
        badShape: expect.stringMatching(/modules must be \{ react, reconciler, constants \}/),
        text: "from modules",
        windows: 1,
        again: null,
        implicit: null,
        otherReact: expect.stringMatching(/already using another copy of React/),
      });
      expect(r.exitCode).toBe(0);
    });
  });
});

type DeclaredClass = { members: Set<string>; defaults: Record<string, unknown>; isView: boolean };

/**
 * Reads packages/bun-types/appkit.d.ts: the members each class declares
 * (own and inherited), the `@default` of each prop in its `*Props` /
 * `WindowOptions` interface where that is a plain literal, the members of
 * `App`, and the runtime exports of the module.
 */
function declaredSurface() {
  const source = readFileSync(join(import.meta.dir, "../../../../packages/bun-types/appkit.d.ts"), "utf8");
  const start = source.indexOf('declare module "bun:appkit" {');
  const end = source.indexOf('declare module "bun:appkit/react"');
  const lines = source.slice(start, end).split("\n");

  type Block = {
    kind: "class" | "interface";
    name: string;
    bases: string[];
    own: string[];
    defaults: Record<string, unknown>;
  };
  const blocks = new Map<string, Block>();
  const exports: string[] = [];
  let current: Block | null = null;
  let comment = "";
  for (const line of lines) {
    const exported = /^  export (?:const|abstract class|class|function) (\w+)/.exec(line);
    if (exported) exports.push(exported[1]);
    const open = /^  export (?:abstract )?(class|interface) (\w+)(?:<[^>]*>)?(?: extends ([\w, ]+))? \{(\})?$/.exec(
      line,
    );
    if (open) {
      const block: Block = {
        kind: open[1] as Block["kind"],
        name: open[2],
        bases: (open[3] ?? "").split(/,\s*/).filter(Boolean),
        own: [],
        defaults: {},
      };
      blocks.set(block.name, block);
      current = open[4] ? null : block;
      comment = "";
      continue;
    }
    if (!current) continue;
    if (line === "  }") {
      current = null;
      continue;
    }
    if (/^    (\/\*\*| \*)/.test(line)) {
      comment += line + "\n";
      continue;
    }
    const member = /^    (?:readonly |get |set )?(\w+)\??(?:<[^>]*>)?[:(]/.exec(line);
    if (member && member[1] !== "constructor") {
      if (!current.own.includes(member[1])) current.own.push(member[1]);
      const documented = /@default (.+?)(?:\s*\*\/)?\n/.exec(comment);
      // Only literal defaults are checked; prose ("0 once there are items") is skipped.
      if (documented && /^(?:-?\d+(?:\.\d+)?|true|false|null|"[^"]*"|\[\])$/.test(documented[1].trim())) {
        current.defaults[member[1]] = JSON.parse(documented[1].trim());
      }
    }
    comment = "";
  }

  const collect = (name: string, pick: (b: Block) => Iterable<[string, unknown]>, into: Map<string, unknown>) => {
    const block = blocks.get(name);
    if (!block) return;
    for (const base of block.bases) collect(base, pick, into);
    for (const [key, value] of pick(block)) into.set(key, value);
  };
  const isView = (name: string): boolean => name === "View" || (blocks.get(name)?.bases.some(isView) ?? false);

  const classes: Record<string, DeclaredClass> = {};
  for (const block of blocks.values()) {
    if (block.kind !== "class") continue;
    const members = new Map<string, unknown>();
    collect(block.name, b => b.own.map(m => [m, true] as [string, unknown]), members);
    const defaults = new Map<string, unknown>();
    collect(
      block.name === "Window" ? "WindowOptions" : `${block.name}Props`,
      b => Object.entries(b.defaults),
      defaults,
    );
    classes[block.name] = {
      members: new Set(members.keys()),
      defaults: Object.fromEntries(defaults),
      isView: isView(block.name),
    };
  }
  return { classes, app: new Set(blocks.get("App")?.own ?? []), exports };
}
