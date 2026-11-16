/** @jsxImportSource bun:desktop */
import { hasLibrary } from "./library";

import {
  act,
  app,
  clipboard,
  Component,
  createContext,
  createPortal,
  dialog,
  Menu,
  Suspense,
  use,
  useContext,
  useEffect,
  useState,
  useWindow,
  Window,
} from "bun:desktop";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

app.on("window-all-closed", () => {});

function open(content: any) {
  const window = new Window({ width: 400, height: 300 });
  act(() => {
    if (typeof content === "string") window.document.body.innerHTML = content;
    else window.render(content);
  });
  const $ = (selector: string) => window.document.querySelector(selector);
  const center = (selector: string) => {
    const { x, y, width, height } = $(selector).getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  };
  const mouse = (type: any, at: { x: number; y: number }, more?: object) =>
    act(() => window.sendInputEvent({ type, ...at, ...more }));
  return {
    window,
    $,
    center,
    mouse,
    click(selector: string, more?: object) {
      for (const type of ["mouseMove", "mouseDown", "mouseUp"]) mouse(type, center(selector), more);
    },
    press(...keys: string[]) {
      for (const keyCode of keys) {
        act(() => window.sendInputEvent({ type: "keyDown", keyCode }));
        act(() => window.sendInputEvent({ type: "keyUp", keyCode }));
      }
    },
    frame: () => new Promise(resolve => window.window.requestAnimationFrame(resolve)),
    [Symbol.dispose]: () => window.destroy(),
  };
}

function record(target: any, types: string, describe = (event: any) => event.type + " " + event.target.id) {
  const log: string[] = [];
  for (const type of types.split(" ")) target.addEventListener(type, (event: any) => log.push(describe(event)), true);
  return log;
}

const shortcut = process.platform === "darwin" ? "Cmd" : "Ctrl";

describe.skipIf(!hasLibrary)("bun:desktop", () => {
  describe("rendering JSX", () => {
    test("state, events and effects", () => {
      const log: string[] = [];
      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          log.push("effect " + count);
          return () => log.push("cleanup " + count);
        }, [count]);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }
      {
        using it = open(<Counter />);
        it.click("button");
        it.click("button");
        expect(it.$("button").textContent).toBe("2");
      }
      expect(log).toEqual(["effect 0", "cleanup 0", "effect 1", "cleanup 1", "effect 2", "cleanup 2"]);
    });

    test("keyed children keep their elements", () => {
      const list = (keys: string) => [...keys].map(key => <i key={key} id={key} />);
      using it = open(list("abc"));
      const [a, c] = [it.$("#a"), it.$("#c")];
      act(() => it.window.render(list("cda")));
      expect(it.window.document.body.innerHTML).toBe('<i id="c"></i><i id="d"></i><i id="a"></i>');
      expect([it.$("#a") === a, it.$("#c") === c]).toEqual([true, true]);
    });

    test("a controlled input only shows what the state says", () => {
      function Digits() {
        const [text, setText] = useState("");
        return <input value={text} onChange={event => setText(event.currentTarget.value.replace(/\D/g, ""))} />;
      }
      using it = open(<Digits />);
      it.click("input");
      it.press("1", "a", "2");
      expect(it.$("input").value).toBe("12");
    });

    test("context, portals, Suspense and error boundaries", async () => {
      const Name = createContext("none");
      const { promise, resolve } = Promise.withResolvers<string>();
      const Reader = () => <b>{useContext(Name) + useWindow().getSize()[0]}</b>;
      const Late = () => <u>{use(promise)}</u>;
      const Broken = () => {
        throw new Error("broken");
      };
      class Boundary extends Component<{ children: any }, { error?: Error }> {
        static getDerivedStateFromError = (error: Error) => ({ error });
        state: { error?: Error } = {};
        render() {
          return this.state.error?.message ?? this.props.children;
        }
      }
      using other = open("");
      using it = open(
        <Name value="name">
          {createPortal(<Reader />, other.window.document.body)}
          <Suspense fallback="waiting ">
            <Late />
          </Suspense>
          <Boundary>
            <Broken />
          </Boundary>
        </Name>,
      );
      expect(other.window.document.body.innerHTML).toBe("<b>name400</b>");
      expect(it.window.document.body.textContent).toBe("waiting broken");
      await act(async () => resolve("late "));
      expect(it.window.document.body.textContent).toBe("late broken");
    });
  });

  describe("mouse", () => {
    test("the events of moving and of clicking", () => {
      using it = open("<div id=a style='height:50px'></div><div id=b style='height:50px'></div>");
      it.mouse("mouseMove", it.center("#a"));
      const log = record(
        it.window.document.body,
        "pointerout pointerover mouseout mouseover pointerdown mousedown click",
      );
      it.click("#b");
      expect(log).toEqual([
        "pointerout a",
        "pointerover b",
        "mouseout a",
        "mouseover b",
        "pointerdown b",
        "mousedown b",
        "click b",
      ]);
      expect(it.$("#b").matches(":hover")).toBe(true);
    });

    test("pointer capture", () => {
      using it = open("<div id=a style='height:50px'></div><div id=b style='height:50px'></div>");
      it.$("#a").onpointerdown = (event: any) => event.target.setPointerCapture(event.pointerId);
      const log = record(it.window.document, "gotpointercapture pointermove pointerup lostpointercapture");
      it.mouse("mouseDown", it.center("#a"));
      it.mouse("mouseMove", it.center("#b"));
      it.mouse("mouseUp", it.center("#b"));
      expect(log.slice(-4)).toEqual(["gotpointercapture a", "pointermove a", "pointerup a", "lostpointercapture a"]);
    });

    test("the wheel scrolls, unless it is canceled", async () => {
      using it = open("<div id=a style='height:100px;overflow:auto'><p style='height:500px'></div>");
      const scrolled = new Promise(resolve => (it.$("#a").onscroll = resolve));
      it.mouse("mouseWheel", { x: 50, y: 50 }, { deltaY: 40 });
      await scrolled;
      expect(it.$("#a").scrollTop).toBe(40);
      it.$("#a").onwheel = (event: Event) => event.preventDefault();
      it.mouse("mouseWheel", { x: 50, y: 50 }, { deltaY: 40 });
      expect(it.$("#a").scrollTop).toBe(40);
    });

    test("a double click selects a word", () => {
      using it = open("<p style='user-select:text'>one <span>two</span> three</p>");
      it.click("span", { clickCount: 2 });
      expect(it.window.getSelectedText().trim()).toBe("two");
    });

    test("drag and drop", () => {
      using it = open("<div id=a draggable=true style='height:50px'></div><div id=b style='height:50px'></div>");
      it.$("#a").ondragstart = (event: any) => event.dataTransfer.setData("text/plain", "x");
      it.$("#b").ondragover = (event: Event) => event.preventDefault();
      const log = record(it.window.document, "drop dragend click", it => it.type + it.dataTransfer?.getData("text"));
      it.mouse("mouseDown", it.center("#a"));
      it.mouse("mouseMove", { x: 10, y: 60 });
      it.mouse("mouseMove", it.center("#b"));
      it.mouse("mouseUp", it.center("#b"));
      expect(log).toEqual(["dropx", "dragend"]);
    });

    test("<select> opens a list", () => {
      using it = open("<select id=s><option>a<option>b</select>");
      const log = record(it.$("select"), "input change");
      it.click("select");
      it.press("Down", "Enter");
      expect([it.$("select").value, ...log]).toEqual(["b", "input s", "change s"]);
    });
  });

  describe("keyboard", () => {
    test("Tab follows tabindex, and skips what cannot be focused", () => {
      using it = open(`<a id=a href=#>a</a><button disabled>x</button><div inert><input></div><input hidden>
        <input id=b><button id=c tabindex=1>c</button>`);
      const order = Array.from("1234", () => (it.press("Tab"), it.window.document.activeElement.id));
      expect(order.slice(0, 3)).toEqual(["c", "a", "b"]);
    });

    test("editing a textarea", () => {
      using it = open("<textarea id=t></textarea>");
      const log = record(it.$("#t"), "beforeinput", event => event.inputType);
      it.click("#t");
      it.press("a", "Enter", "b", "c", "Left", "Backspace");
      expect(it.$("#t").value).toBe("a\nc");
      expect(log).toEqual(["insertText", "insertLineBreak", "insertText", "insertText", "deleteContentBackward"]);
      it.press(shortcut + "+Z");
      expect(it.$("#t").value).toBe("a\nbc");
    });

    test("editing contenteditable", () => {
      using it = open("<div contenteditable><p>ab</p></div>");
      it.$("div").focus();
      it.press("Right", "Enter", "x");
      expect(it.$("div").innerHTML).toBe("<p>a</p><p>xb</p>");
      it.press("Backspace", "Backspace");
      expect(it.$("div").innerHTML).toBe("<p>ab</p>");
    });

    test("copy and paste", () => {
      using it = open("<input id=a value=hello><input id=b>");
      it.$("#a").focus();
      it.$("#a").select();
      it.window.copy();
      expect(clipboard.readText()).toBe("hello");
      it.$("#b").focus();
      it.$("#b").onpaste = (event: any) => expect(event.clipboardData.getData("text/plain")).toBe("hello");
      it.window.paste();
      expect(it.$("#b").value).toBe("hello");
    });

    test.skipIf(process.platform === "darwin")("an accelerator gets the keys that the document leaves", () => {
      using it = open("<input>");
      let clicks = 0;
      it.window.setMenu(Menu.buildFromTemplate([{ label: "A", accelerator: "Ctrl+J", click: () => clicks++ }]));
      it.press("Ctrl+J");
      it.window.document.onkeydown = (event: Event) => event.preventDefault();
      it.press("Ctrl+J");
      expect(clicks).toBe(1);
    });
  });

  test("ResizeObserver and IntersectionObserver", async () => {
    using it = open("<div style='width:10px;height:10px'></div>");
    const log: unknown[] = [];
    new it.window.window.ResizeObserver(([entry]: any) => log.push(entry.contentRect.width)).observe(it.$("div"));
    new it.window.window.IntersectionObserver(([entry]: any) => log.push(entry.isIntersecting)).observe(it.$("div"));
    while (log.length < 2) await it.frame();
    it.$("div").style.cssText = "width:20px;height:10px;margin-top:900px";
    while (log.length < 4) await it.frame();
    expect(log).toEqual([10, true, 20, false]);
  });

  test("transitions fire events", async () => {
    using it = open("<div id=a style='transition:width 1ms;width:10px'></div>");
    const log = record(it.$("div"), "transitionrun transitionstart transitionend");
    it.$("div").offsetWidth;
    it.$("div").style.width = "20px";
    while (log.length < 3) await it.frame();
    expect(log).toEqual(["transitionrun a", "transitionstart a", "transitionend a"]);
  });

  test("capturePage has a horizontal gradient in a box with round corners", async () => {
    using it = open(
      "<div style='width:70px;height:50px;border-radius:12px;background:linear-gradient(90deg,red,blue)'>",
    );
    const bitmap = await it.window.window.createImageBitmap(new Blob([it.window.capturePage().toPNG()]));
    const reader = it.window.document.createElement("canvas").getContext("2d");
    reader.drawImage(bitmap, 0, 0);
    const { x, y } = it.$("div").getBoundingClientRect();
    const pixel = (left: number, top: number) => reader.getImageData(x + left, y + top, 1, 1).data.join();
    expect([pixel(20, 0), pixel(20, 49)]).toEqual([pixel(20, 25), pixel(20, 25)]);
    expect(pixel(0, 0)).not.toBe(pixel(0, 25));
  });

  test("capturePage has what a canvas and CSS draw", async () => {
    using it = open(
      "<style>body{margin:0;background:#00f}canvas{display:block}</style><canvas width=10 height=10></canvas>",
    );
    const context = it.$("canvas").getContext("2d");
    context.fillStyle = "#f00";
    context.fillRect(0, 0, 10, 10);
    const bitmap = await it.window.window.createImageBitmap(new Blob([it.window.capturePage().toPNG()]));
    const reader = it.window.document.createElement("canvas").getContext("2d");
    reader.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(reader.getImageData(x, y, 1, 1).data);
    expect([pixel(5, 5), pixel(50, 50)]).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
  });

  test("loadFile loads style sheets and images", async () => {
    using dir = tempDir("desktop-load", {
      "index.html": `<title>Loaded</title><link rel=stylesheet href=a.css><img src=a.svg>`,
      "a.css": `@import "b.css";`,
      "b.css": `img { order: 7 }`,
      "a.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="34"/>`,
    });
    using it = open("");
    await it.window.loadFile(join(String(dir), "index.html"));
    const image = it.$("img");
    expect([it.window.title, image.naturalWidth, image.height]).toEqual(["Loaded", 12, 34]);
    expect(it.window.window.getComputedStyle(image).order).toBe("7");
  });

  test("a link emits will-navigate", () => {
    using it = open("<a href='https://example.invalid/x'>link</a>");
    const urls: string[] = [];
    it.window.on("will-navigate", (event, url) => {
      event.preventDefault();
      urls.push(url);
    });
    it.click("a");
    expect(urls).toEqual(["https://example.invalid/x"]);
  });

  test("close can be canceled by the document and by a listener", () => {
    using it = open("");
    it.window.window.onbeforeunload = (event: Event) => event.preventDefault();
    it.window.close();
    it.window.window.onbeforeunload = null;
    it.window.once("close", event => event.preventDefault());
    it.window.close();
    expect(it.window.isDestroyed()).toBe(false);
    it.window.close();
    expect(it.window.isDestroyed()).toBe(true);
  });

  test("findInPage", () => {
    using it = open("<p>One two <b>o</b>ne</p>");
    expect(it.window.findInPage("one")).toMatchObject({ matches: 2, active: 1 });
    expect(it.window.findInPage("one", { findNext: false })).toMatchObject({ matches: 2, active: 2 });
    expect(it.window.findInPage("one", { matchCase: true })).toMatchObject({ matches: 1 });
  });

  test("a message box can be aborted", async () => {
    using it = open("");
    const controller = new AbortController();
    const result = dialog.showMessageBox(it.window, {
      message: "Sure?",
      buttons: ["Yes", "No"],
      signal: controller.signal,
    });
    expect(it.window.getChildWindows()[0].document.querySelector("h1").textContent).toBe("Sure?");
    controller.abort();
    expect(await result).toEqual({ response: 1, checkboxChecked: false });
  });

  test("react-dom", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "react-dom.fixture.tsx")],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe('<input value="AB"><button>AB 1</button>\n');
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!hasLibrary)("garbage collection", () => {
  async function run(script: string, env?: object) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `import { app, Window } from "bun:desktop"; const window = new Window({});\n${script}`],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", BUN_GC_TIMER_DISABLE: undefined, ...env },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }
  const garbage = `
    let collected = 0;
    const registry = new FinalizationRegistry(() => collected++ || globalThis.onCollected?.());
    const litter = () => { for (let i = 0; i < 100; i++) registry.register({ i }, i); };
  `;

  test.concurrent("does not run on a timer between frames", async () => {
    const script = `${garbage}
      const frame = () => new Promise(resolve => window.window.requestAnimationFrame(resolve));
      await frame();
      Bun.gc(true);
      litter();
      for (let i = 0; i < 10; i++) await frame();
      console.log(collected);
      app.exit(0);
    `;
    expect(await run(script, { BUN_GC_TIMER_INTERVAL: "1" })).toEqual({ stdout: "0\n", exitCode: 0 });
  });

  test.concurrent("runs once the program has gone quiet", async () => {
    const script = `${garbage}
      globalThis.onCollected = () => { console.log("collected"); app.exit(0); };
      litter();
      for (let i = 0; i < 6; i++) globalThis.last = new Array(131072).fill(i);
    `;
    const env = { BUN_GC_TIMER_INTERVAL: "1000000", BUN_JSC_largeHeapSize: "1000000000" };
    expect(await run(script, env)).toEqual({ stdout: "collected\n", exitCode: 0 });
  });
});

describe.skipIf(!hasLibrary || isWindows)("node:fs lookups", () => {
  async function run(script: string) {
    using dir = tempDir("desktop-fs", { "file.txt": "12345" });
    const before = `import { app, Window } from "bun:desktop"; import fs from "node:fs";
      const window = new Window({});
      const frame = () => new Promise(resolve => window.window.requestAnimationFrame(resolve));
      const here = name => process.cwd() + "/" + name;
      await frame();`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${before}\n${script}\napp.exit(0);`],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
      cwd: String(dir),
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test.concurrent("settle in a later task with the usual results", async () => {
    const script = `
      fs.symlinkSync("file.txt", here("link"));
      const order = [];
      const code = promise => promise.then(() => "ok", error => error.code);
      const size = fs.promises.stat(here("link")).then(it => (order.push("stat"), it.size));
      fs.access(here("file.txt"), () => order.push("access"));
      for (let i = 0; i < 5; i++) await null;
      order.push("microtasks");
      console.log(await size, order[0], await fs.promises.readlink(here("link")), (await fs.promises.lstat(here("link"))).isSymbolicLink());
      for (const name of ["stat", "lstat", "access", "readlink", "readFile", "readdir", "realpath"])
        console.log(await code(fs.promises[name](here("missing"))));
      console.log(await fs.promises.readFile(here("link"), "utf8"));
    `;
    const { stdout, exitCode } = await run(script);
    expect(stdout.trim().split("\n")).toEqual(["5 microtasks file.txt true", ...Array(7).fill("ENOENT"), "12345"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("do not keep frames from being drawn", async () => {
    const script = `
      let isDrawn = false;
      frame().then(() => (isDrawn = true));
      while (!isDrawn) await fs.promises.stat(here("file.txt"));
      console.log("drawn");
    `;
    expect(await run(script)).toEqual({ stdout: "drawn\n", exitCode: 0 });
  });
});
