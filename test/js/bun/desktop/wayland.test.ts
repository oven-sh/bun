import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Heard, openBus } from "./bus";
import * as wl from "./compositor";

const { A, S, C, V, LEFT, ACUTE, ACTIVATED, until } = wl;
const [SHIFT, CONTROL] = [1, 4];
const PRIMARY = "zwp_primary_selection";

type Options = Parameters<typeof wl.openCompositor>[0] & { window?: object; env?: object };

function launch(env: object, cmd: string[] = []) {
  let answer = Promise.withResolvers<any>();
  const proc = Bun.spawn({
    cmd: [...cmd, bunExe(), join(import.meta.dir, "wayland.fixture.ts")],
    env: { ...bunEnv, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nowhere", LC_ALL: "en_US.UTF-8", ...env },
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
    serialization: "json",
    ipc: message => (message.error ? answer.reject(new Error(message.error)) : answer.resolve(message.value)),
    onExit: (_, code, signal) => answer.reject(new Error(`the app has ended: ${code ?? signal}`)),
  });
  const ready = answer.promise;
  return {
    proc,
    async run(code: string) {
      await ready;
      answer = Promise.withResolvers();
      proc.send(code);
      return answer.promise;
    },
  };
}

/** An app with a window that is shown and has the keys. The ids in `html` are variables of what it runs. */
async function open(html = "", { window = {}, env = {}, ...options }: Options = {}) {
  const user = wl.openCompositor(options);
  const { proc, run } = launch({ ...user.env, ...env });
  await run(
    `win = open(${JSON.stringify(html)}, ${JSON.stringify(window)}); for (const it of win.document.querySelectorAll("[id]")) globalThis[it.id] = it;`,
  );
  await until(() => user.top());
  await until(() => run("win.isFocused() && win.document.hasFocus()"));
  await run("new Promise(done => win.window.requestAnimationFrame(() => win.window.requestAnimationFrame(done)))");
  return Object.assign(user, {
    proc,
    run,
    sees: (code: string, value: unknown = true) => until(async () => Bun.deepEquals(await run(code), value)),
    /** What was noted, once there is that much. */
    seen: async (count: number) => (await until(() => run(`seen.length >= ${count}`)), run("seen.splice(0)")),
    click: (x: number, y: number, button = 0) => (
      user.move(x, y),
      user.button(button, true),
      user.button(button, false)
    ),
    shortcut: (mask: number, code: number) => (user.modifiers(mask), user.type(code), user.modifiers(0)),
    async [Symbol.asyncDispose]() {
      proc.kill("SIGKILL");
      await proc.exited;
      user[Symbol.dispose]();
    },
  });
}

describe.skipIf(!wl.hasWayland).concurrent("Wayland", () => {
  const corner = `<i style="position: fixed; right: 0; bottom: 0; width: 10px; height: 10px; background: #f00"></i>`;
  const size = "[win.window.innerWidth, win.window.innerHeight, win.window.devicePixelRatio]";

  test("a window is described before it is shown", async () => {
    await using it = await open("", { window: { minWidth: 120, minHeight: 50 } });
    expect(
      it.take("xdg_toplevel.", "zxdg_toplevel", "xdg_surface.set", "wp_viewport.").filter(it => !it.includes("app_id")),
    ).toEqual([
      "zxdg_toplevel_decoration_v1.set_mode 2",
      'xdg_toplevel.set_title "One"',
      "xdg_toplevel.set_parent null",
      "xdg_toplevel.set_min_size 120 50",
      "xdg_toplevel.set_max_size 0 0",
      "wp_viewport.set_destination 200 100",
      "xdg_surface.set_window_geometry 0 0 200 100",
    ]);
    expect(await it.run("screen.getAllDisplays().map(it => [it.bounds, it.scaleFactor, it.displayFrequency])")).toEqual(
      [[{ x: 0, y: 0, width: 500, height: 400 }, 1, 60]],
    );
  });

  test.each([
    [1.5, [], [300, 150]],
    [2, ["wp_fractional_scale_manager_v1"], [400, 200]],
    [2, ["wp_fractional_scale_manager_v1", "wp_viewporter", "zxdg_output_manager_v1", "wp_presentation"], [400, 200]],
  ])("a scale of %d without %j", async (scale, without, [width, height]) => {
    await using it = await open(corner, { scale, without });
    expect(await it.run(size)).toEqual([200, 100, scale]);
    await until(() => it.top().picture.width === width && it.colorAt(width - 2, height - 2) === "ff0000");
    expect([it.top().picture.height, it.colorAt(width - 12 * scale, height - 2)]).toEqual([height, "ffffff"]);
  });

  test("the scale changes", async () => {
    await using it = await open(corner);
    it.emit("wp_fractional_scale_v1", "preferred_scale", 150);
    await it.sees(size, [200, 100, 1.25]);
    await until(() => it.top().picture.width === 250 && it.colorAt(248, 123) === "ff0000");
  });

  test("a size is answered with a picture of that size", async () => {
    await using it = await open(corner, { window: { minWidth: 120, minHeight: 50 } });
    for (const [given, [width, height]] of [
      [
        [300, 200],
        [300, 200],
      ],
      [
        [10, 10],
        [120, 50],
      ],
      [
        [0, 0],
        [120, 50],
      ],
    ]) {
      it.take();
      const answer = `xdg_surface.ack_configure ${it.configure(given, ACTIVATED, wl.RESIZING)}`;
      await until(() => it.hasSeen(answer));
      await it.ping();
      expect([it.top().picture.width, it.top().picture.height]).toEqual([width, height]);
      await it.sees(size, [width, height, 1]);
      await until(() => it.colorAt(width - 2, height - 2) === "ff0000");
    }
  });

  test("states", async () => {
    await using it = await open();
    await it.run(
      `for (const type of "maximize unmaximize enter-full-screen leave-full-screen minimize restore blur focus close".split(" ")) win.on(type, event => { seen.push(type); event?.preventDefault?.(); })`,
    );
    for (const [call, event, [width, height]] of [
      ["maximize()", "maximize", [500, 400]],
      ["unmaximize()", "unmaximize", [200, 100]],
      ["setFullScreen(true)", "enter-full-screen", [500, 400]],
      ["setFullScreen(false)", "leave-full-screen", [200, 100]],
    ] as const) {
      await it.run("win." + call);
      expect(await it.seen(1)).toEqual([event]);
      await it.sees(size, [width, height, 1]);
    }
    await it.run("win.minimize()");
    expect((await it.seen(2)).sort()).toEqual(["blur", "minimize"]);
    expect(await it.run("[win.isMinimized(), win.document.visibilityState]")).toEqual([true, "hidden"]);
    it.focus(true);
    expect((await it.seen(2)).sort()).toEqual(["focus", "restore"]);
    it.configure([0, 0], ACTIVATED, wl.SUSPENDED);
    await it.sees("win.document.visibilityState", "hidden");
    it.configure([0, 0], ACTIVATED);
    await it.sees("win.document.visibilityState", "visible");
    it.emit("xdg_toplevel", "close");
    expect(await it.seen(1)).toEqual(["close"]);
  });

  test("properties", async () => {
    await using it = await open();
    it.take();
    await it.run(
      `win.setTitle("Two"); win.setOpacity(0); win.setResizable(false); win.setIgnoreMouseEvents(true); win.setIgnoreMouseEvents(false); shell.beep()`,
    );
    await until(() => it.hasSeen("xdg_system_bell_v1.ring"));
    expect(it.take("xdg_toplevel.", "wp_alpha_modifier_surface", "wl_surface.set_input")).toEqual([
      'xdg_toplevel.set_title "Two"',
      "wp_alpha_modifier_surface_v1.set_multiplier 0",
      "xdg_toplevel.set_min_size 200 100",
      "xdg_toplevel.set_max_size 200 100",
      "wl_surface.set_input_region wl_region",
      "wl_surface.set_input_region null",
    ]);
  });

  test("the app draws the frame if the compositor does not", async () => {
    await using it = await open(corner, { without: ["zxdg_decoration_manager_v1"] });
    const top = await it.run("win.getContentBounds().y - win.getBounds().y");
    expect([top > 20, await it.run(size)]).toEqual([true, [200, 100 - top, 1]]);
    await until(() => it.colorAt(190, 92) === "ff0000");
    it.take();
    it.move(50, top / 2);
    it.button(0, true);
    const pressed = it.serial() - 1;
    it.move(60, top / 2);
    await until(() => it.hasSeen("xdg_toplevel.move"));
    it.button(0, false);
    it.move(199, 99);
    it.button(0, true, 1000);
    await until(() => it.hasSeen("xdg_toplevel.resize"));
    it.button(0, false);
    it.click(50, top / 2, 1);
    await until(() => it.hasSeen("xdg_toplevel.show_window_menu"));
    expect(it.take("xdg_toplevel.")).toEqual([
      `xdg_toplevel.move wl_seat ${pressed}`,
      expect.stringMatching(/resize wl_seat \d+ 10$/),
      expect.stringMatching(/show_window_menu wl_seat \d+ 50 \d+$/),
    ]);
  });

  test("dialogs and popups", async () => {
    await using it = await open();
    const first = it.top();
    it.take();
    await it.run(`dialog = open("", { parent: win, modal: true }); 0`);
    await until(() => it.top() !== first);
    expect(it.take("xdg_toplevel.set_parent", "xdg_dialog")).toContainValues([
      "xdg_toplevel.set_parent xdg_toplevel",
      "xdg_dialog_v1.set_modal",
    ]);
    await it.run(`dialog.destroy()`);
    await it.sees("win.isFocused()");
    await it.run(`popup = open("", { type: "popup", x: 30, y: 40, width: 50, height: 60, frame: false }); 0`);
    await until(() => it.top() !== first);
    expect(it.take("xdg_positioner.set_size", "xdg_positioner.set_anchor_rect")).toEqual([
      "xdg_positioner.set_size 50 60",
      "xdg_positioner.set_anchor_rect 30 40 1 1",
    ]);
    expect(await it.run("popup.getBounds()")).toEqual({ x: 30, y: 40, width: 50, height: 60 });
    const below = it.top();
    await it.run(`open("", { type: "popup", parent: win, width: 50, height: 60, frame: false }); 0`);
    await until(() => it.top() !== below);
    await it.run("win.hide()");
    await until(() => !it.top());
    await it.run("win.show()");
    await until(() => it.top());
  });

  test("a window comes to the front with a token", async () => {
    await using it = await open("", { env: { XDG_ACTIVATION_TOKEN: "from the launcher" } });
    expect(it.take("xdg_activation_v1.activate")).toEqual([
      'xdg_activation_v1.activate "from the launcher" wl_surface',
    ]);
    const first = it.top();
    await it.run(`other = open(""); 0`);
    await until(() => it.top() !== first);
    await it.sees("other.isFocused()");
    await it.run("win.focus()");
    await it.sees("win.isFocused()");
    it.take();
    await it.run("other.flashFrame(true)");
    await until(() => it.hasSeen("xdg_activation_v1.activate"));
    expect(it.take("xdg_activation_v1.activate")).toEqual(['xdg_activation_v1.activate "unproven" wl_surface']);
  });

  test("a second instance hands over its token", async () => {
    using dir = tempDir("wl-data", {});
    const lock = `app.setPath("userData", ${JSON.stringify(String(dir))}); app.requestSingleInstanceLock()`;
    await using it = await open();
    expect(await it.run(`app.on("second-instance", () => win.focus()); ${lock}`)).toBe(true);
    it.focus(false);
    await it.sees("win.isFocused()", false);
    const second = launch({ ...it.env, XDG_ACTIVATION_TOKEN: "for the link" });
    await using _ = second.proc;
    expect(await second.run(lock)).toBe(false);
    await it.sees("win.isFocused()");
    expect(it.take("xdg_activation_v1.activate").at(-1)).toBe('xdg_activation_v1.activate "for the link" wl_surface');
  });

  test("the session ends with the connection", async () => {
    await using it = await open();
    await it.run(`app.on("session-end", () => process.exit(7)); 0`);
    it.emit("wl_display", "error", it.top(), 0, "as a test");
    expect(await it.proc.exited).toBe(7);
  });

  test("the mouse", async () => {
    await using it = await open(`<b id=b style="cursor: pointer"></b>`);
    await it.run(
      `watch(b, "mouseenter mouseleave mousedown mouseup click dblclick auxclick", it => [it.button, it.detail, it.clientX, it.clientY])`,
    );
    it.take();
    it.click(10.5, 5);
    it.click(10.5, 5);
    it.click(10.5, 5, 2);
    expect(await it.seen(11)).toEqual([
      "mouseenter 0,0,10,5",
      ...["mousedown", "mouseup", "click"].map(it => it + " 0,1,10,5"),
      ...["mousedown", "mouseup", "click", "dblclick"].map(it => it + " 0,2,10,5"),
      ...["mousedown", "mouseup", "auxclick"].map(it => it + " 1,1,10,5"),
    ]);
    await until(() => it.take("wp_cursor_shape_device_v1.set_shape").at(-1)?.endsWith(" 4"));
    await it.run(`b.style.cursor = "none"`);
    await until(() => it.take("wl_pointer.set_cursor").at(-1)?.endsWith(" null 0 0"));
    it.button(0, true, 5000);
    it.point("leave", it.serial(), it.top());
    expect((await it.seen(4)).map((it: string) => it.split(" ")[0])).toEqual([
      "mousedown",
      "mouseup",
      "click",
      "mouseleave",
    ]);
  });

  test("a cursor from a theme", async () => {
    const image = [36, 0xfffd0002, 24, 1, 2, 2, 1, 0, 0, ...Array(4).fill(0xff0000ff)];
    const file = Buffer.from(new Uint32Array([0x72756358, 16, 0x10000, 1, 0xfffd0002, 24, 28, ...image]).buffer);
    using dir = tempDir("wl-cursors", { "mine/cursors/pointer": file });
    const env = { XCURSOR_PATH: String(dir), XCURSOR_THEME: "mine" };
    await using it = await open(`<b style="cursor: pointer"></b>`, { without: ["wp_cursor_shape_manager_v1"], env });
    it.take();
    it.move(10, 10);
    await until(() => it.hasSeen("wl_pointer.set_cursor"));
    await it.ping();
    expect(it.take("wl_pointer.set_cursor", "wl_shm_pool.create_buffer wl_buffer 0 2 ")).toEqual([
      "wl_shm_pool.create_buffer wl_buffer 0 2 2 8 0",
      expect.stringMatching(/set_cursor \d+ wl_surface 1 0$/),
    ]);
  });

  test("wheels, touchpads and touchscreens", async () => {
    await using it = await open(`<p style="height: 5000px"></p><b id=b style="position: fixed; top: 0"></b>`);
    const { emit } = it;
    it.move(150, 50);
    emit("wl_pointer", "axis_source", 0);
    emit("wl_pointer", "axis_value120", 0, 60);
    it.point("axis", 0, 0, 7.5);
    await it.sees("win.window.scrollY", 60);

    const swipe = (start: number, rest: number) => {
      for (let step = 1; step <= 5; step++)
        (emit("wl_pointer", "axis_source", 1), it.point("axis", start + step * 10, 0, 8));
      emit("wl_pointer", "axis_source", 1);
      it.point("axis_stop", start + 50 + rest, 0);
    };
    await it.run(`watch(win.document, "scrollend", () => win.window.scrollY)`);
    swipe(1000, 500);
    await it.sees("seen.at(-1)", "scrollend 160");
    swipe(2000, 0);
    await it.sees("win.window.scrollY > 400");
    emit("zwp_pointer_gesture_hold_v1", "begin", it.serial(), 0, it.top(), 2);
    await it.sees("seen.at(-1) === 'scrollend ' + win.window.scrollY && win.window.scrollY < 700");

    await it.run(
      `seen.length = 0; win.window.scrollTo(0, 0); watch(b, "click"); watch(win.document, "wheel", it => [it.ctrlKey, it.deltaY < 0])`,
    );
    emit("zwp_pointer_gesture_pinch_v1", "begin", it.serial(), 0, it.top(), 2);
    emit("zwp_pointer_gesture_pinch_v1", "update", 0, 0, 0, 1.5, 0);
    await it.sees(`seen.includes("wheel true,true")`);
    emit("wl_touch", "down", it.serial(), 3000, it.top(), 1, 10, 10);
    emit("wl_touch", "motion", 3010, 1, 12, 11);
    emit("wl_touch", "up", it.serial(), 3020, 1);
    await it.sees(`seen.includes("click")`);
    emit("wl_touch", "down", it.serial(), 4000, it.top(), 2, 150, 90);
    emit("wl_touch", "motion", 4010, 2, 150, 60);
    emit("wl_touch", "motion", 4020, 2, 150, 20);
    emit("wl_touch", "up", it.serial(), 4500, 2);
    await it.sees("win.window.scrollY", 70);
  });

  test("keys", async () => {
    await using it = await open("<input id=i>");
    await it.run(
      `i.focus(); watch(i, "keydown keyup", it => [it.key, it.code, +it.shiftKey, +it.ctrlKey, +it.repeat])`,
    );
    it.type(A);
    it.shortcut(SHIFT, S);
    it.modifiers(0, 1);
    it.type(A);
    it.modifiers(0);
    expect(await it.seen(6)).toEqual([
      ...["keydown a,KeyA,0,0,0", "keyup a,KeyA,0,0,0", "keydown S,KeyS,1,0,0", "keyup S,KeyS,1,0,0"],
      ...["keydown ф,KeyA,0,0,0", "keyup ф,KeyA,0,0,0"],
    ]);
    expect(await it.run("i.value")).toBe("aSф");
    it.modifiers(CONTROL, 1);
    it.type(A);
    await it.sees("[i.selectionStart, i.selectionEnd]", [0, 3]);
    await it.seen(2);
    it.modifiers(0);

    it.emit("wl_keyboard", "repeat_info", 100, 10);
    for (const stop of [() => it.key(V, false), () => it.focus(false)]) {
      await it.run(`i.value = ""; seen.length = 0`);
      it.key(wl.SHIFT, true);
      it.key(V, true);
      await it.sees("i.value.length > 3");
      stop();
      await it.ping();
      expect((await it.seen(3)).slice(0, 3)).toEqual([
        "keydown Shift,ShiftLeft,1,0,0",
        "keydown v,KeyV,0,0,0",
        "keydown v,KeyV,0,0,1",
      ]);
      const settled =
        "new Promise(done => win.window.requestAnimationFrame(() => win.window.requestAnimationFrame(() => done(i.value))))";
      expect(await it.run(settled)).toBe(await it.run(settled));
      it.key(wl.SHIFT, false);
      await it.ping();
      await it.run(settled);
    }
  });

  describe("an input method", () => {
    const told = (it: { take: (start: string) => string[] }) =>
      it
        .take("zwp_text_input_v3.")
        .map(it => it.slice(18))
        .filter(it => /^(en|dis|set_s)/.test(it));
    async function field(html = `<input id=i value="ab é"><input id=p type=password>`) {
      const it = await open(html);
      await it.run(
        `i.focus(); i.setSelectionRange(4, 4); watch(i, "compositionstart compositionupdate compositionend", it => it.data)`,
      );
      await until(() => it.hasSeen('zwp_text_input_v3.set_surrounding_text "ab é" 5 5'));
      return it;
    }

    test("composes, types, and deletes what is around the caret", async () => {
      await using it = await field();
      expect(told(it)[0]).toBe("enable");
      it.edit({ composed: "に" });
      it.edit({ composed: "にほ" });
      it.edit({ typed: "日本" });
      expect(await it.seen(5)).toEqual([
        "compositionstart",
        ...["に", "にほ", "日本"].map(it => "compositionupdate " + it),
        "compositionend 日本",
      ]);
      await until(() => it.hasSeen('zwp_text_input_v3.set_surrounding_text "ab é日本" 11 11'));
      it.edit({ before: 8, typed: "x" });
      await it.sees("i.value", "ab x");
      it.edit({ composed: "y" });
      await it.sees("i.value", "ab xy");
      it.edit({});
      await it.sees("i.value", "ab x");
      it.edit({ composed: "y" });
      it.edit({ before: 2, typed: "z" });
      await it.sees("i.value", "abz");
      expect(told(it)).not.toContain("disable");
    });

    test("is not interrupted when it ends a syllable and begins the next", async () => {
      await using it = await field();
      it.edit({ composed: "한" });
      await it.sees("i.value", "ab é한");
      it.take();
      await it.run("setImmediate(block); 0");
      it.edit({ typed: "한", composed: "ㄱ" });
      await it.ping();
      it.proc.stdin.write("\n");
      await it.sees("i.value", "ab é한ㄱ");
      it.edit({ composed: "그" });
      await it.sees("i.value", "ab é한그");
      await it.ping();
      expect(told(it)).toEqual(['set_surrounding_text "ab é한" 8 8']);
    });

    test("is told that the page has refused the text", async () => {
      await using it = await field();
      await it.run(`i.onbeforeinput = event => event.preventDefault(); 0`);
      it.take();
      it.edit({ typed: "no" });
      await until(() => it.hasSeen('zwp_text_input_v3.set_surrounding_text "ab é" 5 5'));
    });

    test("forgets what it composes after a click, and is off for passwords", async () => {
      await using it = await field();
      it.edit({ composed: "zz" });
      await it.sees("i.value", "ab ézz");
      it.take();
      it.click(90, 10);
      await until(() => it.hasSeen("zwp_text_input_v3.enable"));
      expect([told(it).slice(0, 2), (await it.seen(3)).at(-1)]).toEqual([["disable", "enable"], "compositionend zz"]);
      await it.run("p.focus()");
      await until(() => it.hasSeen("zwp_text_input_v3.disable"));
      expect(told(it)).not.toContain("enable");
    });
  });

  describe("the clipboard", () => {
    test("is offered to other apps", async () => {
      await using it = await open(`<input id=i value="héllo">`);
      await it.run("i.focus()");
      it.shortcut(CONTROL, A);
      await until(() => it.copied(PRIMARY));
      expect(await it.paste("text/plain;charset=utf-8", PRIMARY)).toBe("héllo");
      it.shortcut(CONTROL, C);
      await until(() => it.copied());
      expect(await it.paste("UTF8_STRING")).toBe("héllo");
      await it.run(`clipboard.write({ text: "t", html: "<b>h</b>" })`);
      await until(() => it.copied()?.includes("text/html"));
      expect(await it.paste("text/html")).toEndWith("<b>h</b>");
      await it.run(`clipboard.writeText(Buffer.alloc(300_000, "x").toString())`);
      await until(() => it.copied()?.includes("text/html") === false);
      expect([(await it.paste("text/plain")).length, await it.run("clipboard.readText().length")]).toEqual([
        300_000, 300_000,
      ]);
    });

    test("has what other apps offer", async () => {
      await using it = await open(`<input id=i>`);
      it.copy({ "text/plain;charset=utf-8": "é", "text/html": "<i>é</i>", "text/uri-list": "file:///a%20b\r\n" });
      it.copy({ "text/plain": "selected" }, PRIMARY);
      expect(
        await it.run(
          `[clipboard.readText(), clipboard.readHTML(), clipboard.readFilePaths(), clipboard.readText("selection")]`,
        ),
      ).toEqual(["é", "<i>é</i>", ["/a b"], "selected"]);
      it.copy({ "text/plain": Buffer.alloc(300_000, "y").toString() });
      expect(await it.run("clipboard.readText().length")).toBe(300_000);
      it.click(10, 10, 2);
      await it.sees("i.value", "selected");
    });

    test("is what the compositor says while the app is active", async () => {
      await using it = await open();
      it.copy({ "text/plain": "newer than the last key" });
      expect(await it.run(`clipboard.writeText("turned down"); clipboard.readText()`)).toBe("newer than the last key");
      it.type(LEFT);
      await it.ping();
      await it.run(`clipboard.writeText("mine")`);
      it.focus(false);
      await it.sees("win.isFocused()", false);
      expect(await it.run("clipboard.readText()")).toBe("mine");
    });
  });

  describe("a drag", () => {
    async function start() {
      const it = await open(`<b id=from draggable=true style="background: #f00"></b><b id=to></b>`);
      await it.run(`from.ondragstart = event => event.dataTransfer.setData("text/plain", "hello");
        to.ondragover = to.ondrop = event => event.preventDefault();
        watch(from, "dragend", it => it.dataTransfer.dropEffect);
        watch(to, "drop", it => it.dataTransfer.getData("text/plain") + [...it.dataTransfer.files].map(it => it.name));`);
      return it;
    }
    async function pickUp(it: Awaited<ReturnType<typeof start>>) {
      it.move(10, 10);
      it.button(0, true);
      it.move(30, 10);
      await until(() => it.drag.types());
      it.drag.enter(30, 10);
    }

    test("within the window", async () => {
      await using it = await start();
      await pickUp(it);
      expect(it.take("wl_data_device.start_drag")).toEqual([
        expect.stringMatching(/ wl_data_source wl_surface wl_surface \d+$/),
      ]);
      it.drag.move(30, 30);
      await until(() => it.drag.accepted());
      it.drag.drop();
      expect(await it.seen(2)).toEqual(["drop hello", "dragend copy"]);
    });

    test.each(["dnd_finished", "cancelled"] as const)("out of the window, until %s", async how => {
      await using it = await start();
      await pickUp(it);
      it.drag.move(30, 30);
      await until(() => it.drag.accepted());
      it.drag.leave();
      expect(await it.drag.read("text/plain")).toBe("hello");
      it.drag.end(how);
      expect(await it.seen(1)).toEqual(["dragend none"]);
      await it.run(`watch(to, "click")`);
      it.click(30, 30);
      expect(await it.seen(1)).toEqual(["click"]);
    });

    test("of files from another app", async () => {
      using dir = tempDir("wl-files", { "a b.txt": "" });
      await using it = await start();
      it.drag.start({ "text/uri-list": pathToFileURL(join(String(dir), "a b.txt")) + "\r\n" });
      it.drag.enter(150, 50);
      await until(() => it.drag.accepted());
      it.drag.move(30, 30);
      it.drag.drop();
      expect(await it.seen(1)).toEqual(["drop a b.txt"]);
      expect(it.take("wl_data_offer.set_actions", "wl_data_offer.finish")).toEqual([
        "wl_data_offer.set_actions 1 1",
        "wl_data_offer.finish",
      ]);
    });
  });

  test("idle time", async () => {
    await using it = await open();
    expect(await it.run("powerMonitor.getSystemIdleTime()")).toBe(0);
    await until(() =>
      it.hasSeen("ext_idle_notifier_v1.get_input_idle_notification ext_idle_notification_v1 1000 wl_seat"),
    );
    it.emit("ext_idle_notification_v1", "idled");
    await it.sees("powerMonitor.getSystemIdleTime() > 0");
    it.emit("ext_idle_notification_v1", "resumed");
    await it.sees("powerMonitor.getSystemIdleTime()", 0);
  });

  test("displays", async () => {
    await using it = await open();
    await it.run(
      `screen.on("display-metrics-changed", (_, it) => seen.push([it.bounds.width, it.scaleFactor, it.displayFrequency])); 0`,
    );
    it.emit("wl_output", "mode", 1, 1000, 800, 120000);
    it.emit("wl_output", "done");
    expect(await it.seen(1)).toEqual([[500, 2, 120]]);
  });

  describe("the desktop", () => {
    const [DAEMON, PORTAL, PROPERTIES] = [
      "org.freedesktop.DBus.",
      "org.freedesktop.portal.",
      "org.freedesktop.DBus.Properties.",
    ];
    const DESKTOP = "/org/freedesktop/portal/desktop";
    const heard = async (bus: ReturnType<typeof openBus>, name: string) => (
      await until(() => bus.find(name)),
      bus.find(name)!
    );

    /** A call that returns a request, which is answered later. */
    const answers = (bus: () => ReturnType<typeof openBus>, results: (call: Heard) => object) => (call: Heard) => {
      const request = `${DESKTOP}/request/${call.from.name.slice(1).replace(".", "_")}/${call.body.at(-1).handle_token}`;
      queueMicrotask(() => bus().signal(call.from, request, PORTAL + "Request.Response", "ua{sv}", 0, results(call)));
      return ["o", request] as [string, string];
    };

    test("binds global shortcuts", async () => {
      let [bound, session] = [[] as string[], ""];
      const list = () => ({ shortcuts: ["a(sa{sv})", bound.map(it => [it, {}])] });
      using bus = openBus({
        [PROPERTIES + "Get"]: () => ["v", ["u", 1]],
        [PORTAL + "GlobalShortcuts.CreateSession"]: answers(
          () => bus,
          it => ({ session_handle: ["s", (session = `${DESKTOP}/session/${it.body[0].session_handle_token}`)] }),
        ),
        [PORTAL + "GlobalShortcuts.ListShortcuts"]: answers(() => bus, list),
        [PORTAL + "GlobalShortcuts.BindShortcuts"]: answers(
          () => bus,
          it => ((bound = it.body[1].map((it: any) => it[0])), list()),
        ),
      });
      await using it = await open("", { env: bus.env });
      const register = (keys: string) =>
        `globalShortcut.register("${keys}", () => { seen.push("${keys}"); win.focus(); })`;
      expect(await it.run(`[${["Ctrl+Alt+Space", "Super+Shift+F5", "Ctrl+,", "Alt+K"].map(register)}]`)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      const { from, body } = await heard(bus, PORTAL + "GlobalShortcuts.BindShortcuts");
      expect(body[1].map((it: any) => it[1].preferred_trigger)).toEqual([
        "CTRL+ALT+space",
        "SHIFT+LOGO+F5",
        "CTRL+comma",
        "ALT+k",
      ]);
      expect(bus.take("org.freedesktop.host.portal.Registry.Register", PORTAL + "Global")[0].name).toEndWith(
        "Register",
      );

      it.focus(false);
      await it.sees("win.isFocused()", false);
      const press = (session: string, keys: string) =>
        bus.signal(from, DESKTOP, PORTAL + "GlobalShortcuts.Activated", "osta{sv}", session, keys, 0, {
          activation_token: ["s", "pressed"],
        });
      press(DESKTOP + "/session/another", "ALT+k");
      press(session, "CTRL+comma");
      expect(await it.seen(1)).toEqual(["Ctrl+,"]);
      await until(() => it.hasSeen('xdg_activation_v1.activate "pressed"'));

      const first = session;
      await it.run(`globalShortcut.unregister("Alt+K")`);
      await heard(bus, PORTAL + "GlobalShortcuts.ListShortcuts");
      expect(bus.find(PORTAL + "Session.Close")?.path).toBe(first);
      press(session, "ALT+k");
      press(session, "SHIFT+LOGO+F5");
      expect([await it.seen(1), bus.find(PORTAL + "GlobalShortcuts.BindShortcuts")]).toEqual([
        ["Super+Shift+F5"],
        undefined,
      ]);
    });

    test("may not have global shortcuts", async () => {
      using bus = openBus({});
      await using it = await open("", { env: bus.env });
      expect(await it.run(`globalShortcut.register("Alt+K", () => {})`)).toBe(false);
    });

    test("has settings", async () => {
      const settings: any = { "color-scheme": ["u", 1], "double-click": ["i", 50], "button-layout": ["s", "close:"] };
      using bus = openBus({ [PORTAL + "Settings.Read"]: it => ["v", ["v", settings[it.body[1]] ?? ["s", ""]]] });
      await using it = await open("<b id=b></b>", { env: bus.env, without: ["zxdg_decoration_manager_v1"] });
      await it.sees("nativeTheme.shouldUseDarkColors");
      const { from } = await heard(bus, PORTAL + "Settings.Read");
      for (const [key, value] of [
        ["color-scheme", 2],
        ["contrast", 1],
        ["reduced-motion", 1],
      ]) {
        bus.signal(from, DESKTOP, PORTAL + "Settings.SettingChanged", "ssv", "org.freedesktop.appearance", key, [
          "u",
          value,
        ]);
      }
      await it.sees(
        `["(prefers-color-scheme: light)", "(prefers-contrast: more)", "(prefers-reduced-motion)"].every(it => win.window.matchMedia(it).matches)`,
      );
      const top = await it.run(
        `watch(b, "click", it => it.detail); win.on("close", event => { event.preventDefault(); seen.push("close"); }); win.getContentBounds().y`,
      );
      it.move(10, top + 10);
      for (const time of [1000, 1040, 2000, 2060]) (it.button(0, true, time), it.button(0, false, time));
      it.click(top / 2, top / 2);
      expect(await it.seen(5)).toEqual(["click 1", "click 2", "click 1", "click 1", "close"]);
    });

    test("lets the user choose files", async () => {
      using bus = openBus({
        [DAEMON + "GetId"]: () => ["s", "id"],
        [PORTAL + "FileChooser.OpenFile"]: answers(
          () => bus,
          () => ({ uris: ["as", ["file:///a%20b", "file:///c"]] }),
        ),
      });
      await using it = await open("", { env: bus.env });
      const options = {
        title: "Which?",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Text", extensions: ["txt"] }],
      };
      expect(await it.run(`dialog.showOpenDialog(win, ${JSON.stringify(options)})`)).toEqual({
        canceled: false,
        filePaths: ["/a b", "/c"],
      });
      expect(bus.take(PORTAL + "FileChooser")[0].body).toEqual([
        "wayland:exported",
        "Which?",
        { handle_token: "files", multiple: true, directory: false, filters: [["Text", [[0, "*.txt"]]]] },
      ]);
    });

    test("shows notifications", async () => {
      const NOTIFICATIONS = "org.freedesktop.Notifications.";
      using bus = openBus({ [NOTIFICATIONS + "Notify"]: () => ["u", 7] });
      await using it = await open("", { env: bus.env });
      await it.run(
        `note = new Notification({ title: "Title", body: "a <b>" }); note.on("click", () => { seen.push("click"); win.focus(); }); note.show()`,
      );
      const { from, body } = await heard(bus, NOTIFICATIONS + "Notify");
      expect(body.slice(3, 6)).toEqual(["Title", "a &lt;b&gt;", ["default", ""]]);
      it.focus(false);
      await it.sees("win.isFocused()", false);
      bus.signal(from, "/", NOTIFICATIONS + "ActionInvoked", "us", 8, "default");
      bus.signal(from, "/", NOTIFICATIONS + "ActivationToken", "us", 7, "clicked");
      bus.signal(from, "/", NOTIFICATIONS + "ActionInvoked", "us", 7, "default");
      await until(() => it.hasSeen('xdg_activation_v1.activate "clicked"'));
      expect(await it.seen(1)).toEqual(["click"]);
    });

    test("has a tray", async () => {
      using bus = openBus({
        [DAEMON + "NameHasOwner"]: it => ["b", it.body[0].includes("Watcher")],
        [DAEMON + "RequestName"]: () => ["u", 1],
      });
      await using it = await open("", { env: bus.env });
      await it.run(`tray = new Tray(nativeImage.createFromBitmap(Buffer.from([3, 2, 1, 255]), { width: 1, height: 1 }));
        tray.setToolTip("Tip");
        tray.on("click", () => seen.push("tray"));
        tray.setContextMenu(Menu.buildFromTemplate([{ label: "a_b", click: () => seen.push("item") }, { type: "separator" }, { label: "c", type: "checkbox", checked: true, enabled: false }]));`);
      const { from } = await heard(bus, "org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem");
      await heard(bus, "com.canonical.dbusmenu.LayoutUpdated");
      const [item] = await bus.call(
        from,
        "/StatusNotifierItem",
        PROPERTIES + "GetAll",
        "s",
        "org.kde.StatusNotifierItem",
      );
      expect([item.IconPixmap, item.ToolTip[2]]).toEqual([[[1, 1, [255, 1, 2, 3]]], "Tip"]);
      const [, [, , items]] = await bus.call(from, item.Menu, "com.canonical.dbusmenu.GetLayout", "iias", 0, -1, []);
      expect(items.map((it: any) => it[1])).toEqual([
        { label: "a__b" },
        { type: "separator" },
        { label: "c", enabled: false, "toggle-type": "checkmark", "toggle-state": 1 },
      ]);
      for (const [id] of items.toReversed())
        await bus.call(from, item.Menu, "com.canonical.dbusmenu.Event", "isvu", id, "clicked", ["s", ""], 0);
      await bus.call(from, "/StatusNotifierItem", "org.kde.StatusNotifierItem.Activate", "ii", 1, 2);
      expect(await it.seen(2)).toEqual(["item", "tray"]);
    });

    test("has IBus if the compositor has no input method", async () => {
      const CONTEXT = "org.freedesktop.IBus.InputContext.";
      const text = (it: string) => ["(sa{sv}sv)", ["IBusText", {}, it, ["s", ""]]];
      using bus = openBus({
        "org.freedesktop.IBus.CreateInputContext": () => ["o", "/context"],
        [CONTEXT + "ProcessKeyEvent"]({ from, body: [, code, state] }) {
          if (!state && code === A)
            bus.signal(from, "/context", CONTEXT + "UpdatePreeditText", "vub", text("あ"), 1, true);
          if (!state && (code === S || code === C))
            bus.signal(from, "/context", CONTEXT + "CommitText", "v", text("亜"));
          return ["b", code !== V && code !== C];
        },
        [CONTEXT + "Reset"]: ({ from }) => (
          bus.signal(from, "/context", CONTEXT + "CommitText", "v", text("あ")),
          [""]
        ),
      });
      using dir = tempDir("ibus", { "machine-id": "" });
      const machine = await Promise.any(
        ["/var/lib/dbus/machine-id", "/etc/machine-id"].map(it => Bun.file(it).text()),
      ).catch(() => null);
      if (machine !== null)
        await Bun.write(
          join(String(dir), "ibus/bus", machine.trim() + "-unix-socket"),
          `IBUS_ADDRESS=${bus.address}\n`,
        );
      const env =
        machine === null ? { IBUS_ADDRESS: bus.address } : { IBUS_ADDRESS: undefined, XDG_CONFIG_HOME: String(dir) };
      await using it = await open("<input id=i><input id=j>", { env, without: ["zwp_text_input_manager_v3"] });
      await it.run("i.focus()");
      await heard(bus, CONTEXT + "SetCursorLocation");
      it.type(A);
      await it.sees("i.value", "あ");
      it.type(S, V);
      await it.sees("i.value", "亜v");
      it.type(A, C, A);
      await it.sees("i.value", "亜v亜cあ");
      await it.run("j.focus()");
      await heard(bus, CONTEXT + "Reset");
      it.type(V);
      await it.sees("[i.value, j.value].join()", "亜v亜cあ,v");
    });

    test("has a screen reader", async () => {
      const [ATSPI, STATUS] = ["org.a11y.atspi.", "/org/a11y/bus"];
      using bus = openBus({
        [DAEMON + "GetId"]: () => ["s", "id"],
        [DAEMON + "NameHasOwner"]: () => ["b", true],
        [PROPERTIES + "GetAll"]: () => ["a{sv}", { IsEnabled: ["b", false], ScreenReaderEnabled: ["b", false] }],
        "org.a11y.Bus.GetAddress": () => ["s", bus.address],
        [ATSPI + "Socket.Embed"]: () => ["(so)", [":1.0", "/desktop"]],
        [ATSPI + "Registry.GetRegisteredEvents"]: () => ["a(ss)", [[":1.0", "object:"]]],
        [ATSPI + "DeviceEventController.NotifyListenersSync"]: it => ["b", it.body[0][5] === "s"],
      });
      await using it = await open(
        `<h2>Head</h2><button id=b>Go</button><input id=i aria-label=Name value=xy><p id=p role=status></p>`,
        { env: bus.env },
      );
      const session = (await heard(bus, PROPERTIES + "GetAll")).from;
      expect([await it.run("app.isAccessibilitySupportEnabled()"), bus.take("org.a11y")]).toEqual([false, []]);
      bus.signal(
        session,
        STATUS,
        PROPERTIES + "PropertiesChanged",
        "sa{sv}as",
        "org.a11y.Status",
        { ScreenReaderEnabled: ["b", true] },
        [],
      );
      const { from, body } = await heard(bus, ATSPI + "Socket.Embed");
      await heard(bus, ATSPI + "Event.Window.Activate");

      const ask = async (path: string, name: string, ...rest: any[]) =>
        (await bus.call(from, path, ATSPI + name, ...((rest.length ? rest : [""]) as [string])))[0];
      const get = async (path: string, name: string) =>
        (await bus.call(from, path, PROPERTIES + "Get", "ss", ...(ATSPI + name).split(/\.(?=\w+$)/)))[0];
      const paths: Record<string, string> = {};
      async function describe(path: string): Promise<any> {
        const [role, name, children] = await Promise.all([
          ask(path, "Accessible.GetRoleName"),
          get(path, "Accessible.Name"),
          ask(path, "Accessible.GetChildren"),
        ]);
        paths[name] = path;
        return [`${role} ${name}`.trim(), ...(await Promise.all(children.map((it: string[]) => describe(it[1]))))];
      }
      const [[, window]] = await ask(body[0][1], "Accessible.GetChildren");
      await until(async () => (await get(window, "Accessible.ChildCount")) === 1);
      expect(await describe(window)).toEqual([
        "frame One",
        ["document web", ["heading Head", ["static Head"]], ["push button Go"], ["entry Name"], ["status bar"]],
      ]);

      await it.run(`watch(b, "click"); b.onclick = () => (p.textContent = "Done"); 0`);
      expect(await ask(paths.Go, "Action.DoAction", "i", 0)).toBe(true);
      expect(await it.seen(1)).toEqual(["click"]);
      const events = () =>
        bus
          .take(ATSPI + "Event.Object")
          .map(it => [it.name.slice(28), it.path === paths.Name ? "field" : "", ...it.body.slice(0, 4)].join(" "));
      const all: string[] = [];
      const hears = (event: string) => until(() => all.push(...events()) && all.includes(event));
      await ask(paths.Name, "Component.GrabFocus");
      await hears("StateChanged field focused 1 0 0");
      await it.run("i.setSelectionRange(2, 2)");
      it.type(S, A);
      await hears("TextChanged field insert 2 1 a");
      await hears("TextCaretMoved field  3 0 0");
      expect([await ask(paths.Name, "Text.GetText", "ii", 0, -1), await get(paths.Name, "Text.CaretOffset")]).toEqual([
        "xya",
        3,
      ]);
      expect(all.filter(it => it.endsWith("Done"))).toEqual(["TextChanged  insert 0 4 Done"]);
    });
  });
});
