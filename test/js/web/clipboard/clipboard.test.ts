// The async Clipboard API: https://w3c.github.io/clipboard-apis/
// The OS round-trip tests are environment-adaptive: a machine with no
// reachable system clipboard must reject with a "NotAllowedError"
// DOMException instead, and that shape is asserted.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// A valid 1x1 transparent PNG; used to prove binary representations survive
// the platform round-trip.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Asserts that `promise` rejects with a DOMException of exactly `name`.
async function expectDOMException(promise: Promise<unknown>, name: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DOMException);
  expect((error as DOMException).name).toBe(name);
}

describe("interface shape", () => {
  test("navigator.clipboard exists and is the [SameObject] Clipboard singleton", () => {
    expect(navigator.clipboard).toBeDefined();
    expect(navigator.clipboard).toBeInstanceOf(Clipboard);
    expect(navigator.clipboard).toBeInstanceOf(EventTarget);
    // [SameObject]
    expect(navigator.clipboard).toBe(navigator.clipboard);
    // `clipboard` is a getter on the navigator object, like its other props.
    expect(typeof Object.getOwnPropertyDescriptor(navigator, "clipboard")?.get).toBe("function");
  });

  test("Clipboard is a global interface object extending EventTarget", () => {
    expect(typeof Clipboard).toBe("function");
    expect(Clipboard.name).toBe("Clipboard");
    expect(globalThis.Clipboard).toBe(Clipboard);
    expect(Object.getPrototypeOf(Clipboard.prototype)).toBe(EventTarget.prototype);
  });

  test("new Clipboard() throws an Illegal constructor TypeError", () => {
    // @ts-expect-error — Clipboard has no public constructor.
    expect(() => new Clipboard()).toThrow(TypeError);
    // @ts-expect-error — Clipboard has no public constructor.
    expect(() => new Clipboard()).toThrow("Illegal constructor");
  });

  test("prototype members are enumerable functions with the right arity", () => {
    // WebIDL: interface members are enumerable, unlike plain JS class methods.
    expect(Object.keys(Clipboard.prototype)).toEqual(["readText", "writeText", "read", "write"]);
    expect(Clipboard.prototype.readText.length).toBe(0);
    expect(Clipboard.prototype.writeText.length).toBe(1);
    expect(Clipboard.prototype.read.length).toBe(0);
    expect(Clipboard.prototype.write.length).toBe(1);
  });

  test("Symbol.toStringTag is 'Clipboard'", () => {
    expect(Object.prototype.toString.call(navigator.clipboard)).toBe("[object Clipboard]");
    expect(Object.getOwnPropertyDescriptor(Clipboard.prototype, Symbol.toStringTag)).toEqual({
      value: "Clipboard",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  });

  test("readText()/writeText() return Promises and reject (not throw) on a bad receiver", async () => {
    // WebIDL: a Promise-returning operation converts a failed brand check
    // into a rejection, never a synchronous throw.
    const detached = Clipboard.prototype.readText.call({} as Clipboard);
    expect(detached).toBeInstanceOf(Promise);
    await expect(detached).rejects.toThrow(TypeError);
    await expect(Clipboard.prototype.writeText.call({} as Clipboard, "x")).rejects.toThrow(TypeError);
    await expect(Clipboard.prototype.read.call({} as Clipboard)).rejects.toThrow(TypeError);
    await expect(Clipboard.prototype.write.call({} as Clipboard, [])).rejects.toThrow(TypeError);
  });

  test("writeText() argument handling follows WebIDL", async () => {
    // @ts-expect-error — writeText requires 1 argument.
    await expect(navigator.clipboard.writeText()).rejects.toThrow(TypeError);
    // The DOMString conversion of a Symbol throws before any platform code runs.
    await expect(navigator.clipboard.writeText(Symbol("x") as unknown as string)).rejects.toThrow(TypeError);
  });

  // The bytecode linker resolves bare globals before any statement runs, so
  // `Clipboard` cannot be a lookup-table PropertyCallback (its callback would
  // have to run the Clipboard.ts builtin at link time). This pins that.
  test("bare `Clipboard` identifier as the first statement of a process", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(Clipboard.prototype === navigator.clipboard.constructor.prototype)"],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "true", exitCode: 0 });
  });

  // WebIDL: the interface objects are writable globals, so polyfills and test
  // mocks can replace them. Last in the suite: it swaps the real class out.
  test("globalThis.Clipboard is replaceable", () => {
    const original = Clipboard;
    try {
      // @ts-expect-error — intentionally assigning a non-Clipboard value.
      globalThis.Clipboard = 123;
      expect(globalThis.Clipboard).toBe(123);
    } finally {
      globalThis.Clipboard = original;
    }
    expect(globalThis.Clipboard).toBe(original);
    expect(navigator.clipboard).toBeInstanceOf(original);
  });
});

describe("ClipboardItem", () => {
  test("is a constructible global with the right shape", () => {
    expect(typeof ClipboardItem).toBe("function");
    expect(globalThis.ClipboardItem).toBe(ClipboardItem);
    const item = new ClipboardItem({ "text/plain": "hello" });
    expect(item).toBeInstanceOf(ClipboardItem);
    expect(Object.prototype.toString.call(item)).toBe("[object ClipboardItem]");
    expect(typeof ClipboardItem.supports).toBe("function");
  });

  test("constructor validates its arguments like the spec", () => {
    // @ts-expect-error — requires an items record.
    expect(() => new ClipboardItem()).toThrow(TypeError);
    expect(() => new ClipboardItem({})).toThrow(TypeError);
    expect(() => new ClipboardItem({ "not a mime": "x" })).toThrow(TypeError);
    expect(() => new ClipboardItem({ "text/plain": "x" }, { presentationStyle: "nope" as never })).toThrow(TypeError);
  });

  test("types is frozen and preserves insertion order; presentationStyle defaults", () => {
    const item = new ClipboardItem({ "text/plain": "a", "text/html": "<b>a</b>" }, { presentationStyle: "inline" });
    expect(item.types).toEqual(["text/plain", "text/html"]);
    expect(Object.isFrozen(item.types)).toBe(true);
    expect(item.presentationStyle).toBe("inline");
    expect(new ClipboardItem({ "text/plain": "a" }).presentationStyle).toBe("unspecified");
  });

  test("getType() resolves Blobs of the requested type from strings, Blobs, and promises", async () => {
    const item = new ClipboardItem({
      "text/plain": "as a string",
      "text/html": Promise.resolve("<b>as a promise</b>"),
      // A Blob whose declared type differs is rewrapped as the requested type.
      "image/png": new Blob([PNG_1X1], { type: "application/octet-stream" }),
    });
    // Bun's Blob normalizes text MIME types with a charset parameter, so the
    // returned types are asserted exactly as Blob reports them.
    const plain = await item.getType("text/plain");
    expect(plain).toBeInstanceOf(Blob);
    expect(plain.type).toBe("text/plain;charset=utf-8");
    expect(await plain.text()).toBe("as a string");
    const html = await item.getType("text/html");
    expect(await html.text()).toBe("<b>as a promise</b>");
    expect(html.type).toBe("text/html;charset=utf-8");
    const png = await item.getType("image/png");
    expect(png.type).toBe("image/png");
    expect(Buffer.from(await png.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  test("getType() of an absent type rejects with a NotFoundError DOMException", async () => {
    const item = new ClipboardItem({ "text/plain": "x" });
    await expectDOMException(item.getType("image/png"), "NotFoundError");
  });

  test("supports() tells the per-platform truth", () => {
    expect(ClipboardItem.supports("text/plain")).toBe(true);
    expect(ClipboardItem.supports("image/png")).toBe(true);
    expect(ClipboardItem.supports("text/html")).toBe(process.platform !== "win32");
    expect(ClipboardItem.supports("application/x-bun-custom")).toBe(false);
  });

  test("accessors brand-check their receiver", () => {
    const proto = ClipboardItem.prototype;
    expect(() => Object.getOwnPropertyDescriptor(proto, "types")!.get!.call({})).toThrow(TypeError);
    expect(() => Object.getOwnPropertyDescriptor(proto, "presentationStyle")!.get!.call({})).toThrow(TypeError);
  });
});

describe("ClipboardEvent", () => {
  test("is a constructible Event subclass that can be dispatched synthetically", () => {
    expect(typeof ClipboardEvent).toBe("function");
    expect(Object.getPrototypeOf(ClipboardEvent.prototype)).toBe(Event.prototype);
    const event = new ClipboardEvent("paste", { bubbles: true });
    expect(event).toBeInstanceOf(ClipboardEvent);
    expect(event).toBeInstanceOf(Event);
    expect(event.type).toBe("paste");
    expect(event.bubbles).toBe(true);
    // Bun has no DataTransfer, so this is always null.
    expect(event.clipboardData).toBeNull();
    expect(Object.prototype.toString.call(event)).toBe("[object ClipboardEvent]");

    const target = new EventTarget();
    const seen: string[] = [];
    target.addEventListener("copy", e => {
      seen.push((e as ClipboardEvent).type);
    });
    target.dispatchEvent(new ClipboardEvent("copy"));
    expect(seen).toEqual(["copy"]);
  });

  test("constructor and brand checks reject bad use", () => {
    // @ts-expect-error — a type argument is required.
    expect(() => new ClipboardEvent()).toThrow(TypeError);
    const get = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, "clipboardData")!.get!;
    expect(() => get.call(new Event("copy"))).toThrow(TypeError);
  });
});

describe("read / write", () => {
  // Everything here rejects during validation, before any OS access, so it is
  // deterministic on every platform including headless CI.
  test("write() argument validation follows the spec, before touching the OS", async () => {
    // @ts-expect-error — write requires 1 argument.
    await expect(navigator.clipboard.write()).rejects.toThrow(TypeError);
    await expect(navigator.clipboard.write(123 as never)).rejects.toThrow(TypeError);
    await expect(navigator.clipboard.write([{} as ClipboardItem])).rejects.toThrow(TypeError);

    const a = new ClipboardItem({ "text/plain": "a" });
    const b = new ClipboardItem({ "text/plain": "b" });
    await expectDOMException(navigator.clipboard.write([a, b]), "NotAllowedError");

    // An unsupported representation rejects the write — including when the
    // item also carries supported ones (nothing is silently dropped).
    await expectDOMException(
      navigator.clipboard.write([new ClipboardItem({ "application/x-bun": "x" })]),
      "NotAllowedError",
    );
    await expectDOMException(
      navigator.clipboard.write([new ClipboardItem({ "text/plain": "x", "application/x-bun": "y" })]),
      "NotAllowedError",
    );

    // Writing an empty sequence is a no-op that must not reject.
    await navigator.clipboard.write([]);
  });

  test("round-trips representations, or rejects with NotAllowedError where there is no clipboard", async () => {
    let saved: ClipboardItem[] = [];
    try {
      saved = await navigator.clipboard.read();
    } catch (e) {
      // No reachable clipboard (e.g. headless Linux): read() and write()
      // must fail with the same spec'd shape.
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe("NotAllowedError");
      await expectDOMException(navigator.clipboard.read(), "NotAllowedError");
      await expectDOMException(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "x" })]),
        "NotAllowedError",
      );
      return;
    }
    try {
      // A unique token makes an unrelated process racing the clipboard a
      // visible mismatch instead of a false pass.
      const token = `bun clipboard read/write ${Date.now()} ${Math.random()}`;
      const types: Record<string, string | Blob> = { "text/plain": token };
      const withHtml = ClipboardItem.supports("text/html");
      if (withHtml) types["text/html"] = `<b>${token}</b>`;
      await navigator.clipboard.write([new ClipboardItem(types)]);

      const items = await navigator.clipboard.read();
      expect(items).toHaveLength(1);
      expect(items[0]).toBeInstanceOf(ClipboardItem);
      expect(items[0].types).toEqual(withHtml ? ["text/plain", "text/html"] : ["text/plain"]);
      expect(await (await items[0].getType("text/plain")).text()).toBe(token);
      if (withHtml) {
        expect(await (await items[0].getType("text/html")).text()).toBe(`<b>${token}</b>`);
      }
      // readText() sees the text/plain representation written by write().
      expect(await navigator.clipboard.readText()).toBe(token);

      // Binary representations survive the platform round-trip.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([PNG_1X1], { type: "image/png" }) })]);
      const [imageItem] = await navigator.clipboard.read();
      expect(imageItem.types).toEqual(["image/png"]);
      const pngBytes = Buffer.from(await (await imageItem.getType("image/png")).arrayBuffer());
      if (process.platform === "win32") {
        // The Win32 clipboard reports `GlobalSize`, which over-reports by
        // allocation granularity; the real payload is a prefix.
        expect(pngBytes.length).toBeGreaterThanOrEqual(PNG_1X1.length);
        expect(pngBytes.subarray(0, PNG_1X1.length).equals(PNG_1X1)).toBe(true);
      } else {
        expect(pngBytes.equals(PNG_1X1)).toBe(true);
      }
    } finally {
      // Put back whatever was on the clipboard before the test (all supported
      // representations, not just text) so running locally is non-destructive.
      if (saved.length > 0) await navigator.clipboard.write(saved).catch(() => {});
      else await navigator.clipboard.writeText("").catch(() => {});
    }
  });
});

describe("clipboard events", () => {
  // Bun's projection of the spec's clipboard actions onto a runtime: writes
  // that place data fire "copy", successful reads fire "paste" (both at
  // `navigator.clipboard`), failures fire nothing, and "cut" never auto-fires.
  test("copy/paste fire at navigator.clipboard on success, and only on success", async () => {
    // Save before attaching listeners so the save itself is not recorded.
    let saved: string | null = null;
    let unavailable = false;
    try {
      saved = await navigator.clipboard.readText();
    } catch {
      unavailable = true;
    }
    const events: string[] = [];
    let lastEvent: ClipboardEvent | null = null;
    const record = (e: Event) => {
      events.push(e.type);
      lastEvent = e as ClipboardEvent;
    };
    navigator.clipboard.addEventListener("copy", record);
    navigator.clipboard.addEventListener("paste", record);
    navigator.clipboard.addEventListener("cut", record);
    try {
      const token = `clipboard-events ${Date.now()} ${Math.random()}`;
      if (unavailable) {
        // With no reachable clipboard every operation rejects — and a failed
        // operation must not fire any event.
        await expectDOMException(navigator.clipboard.writeText(token), "NotAllowedError");
        await expectDOMException(navigator.clipboard.readText(), "NotAllowedError");
        expect(events).toEqual([]);
        return;
      }
      await navigator.clipboard.writeText(token);
      expect(events).toEqual(["copy"]);
      // The fired event has the spec'd shape and targets navigator.clipboard.
      expect(lastEvent).toBeInstanceOf(ClipboardEvent);
      expect(lastEvent!.type).toBe("copy");
      expect(lastEvent!.target).toBe(navigator.clipboard);
      expect(lastEvent!.bubbles).toBe(false);
      expect(lastEvent!.cancelable).toBe(false);
      expect(lastEvent!.clipboardData).toBeNull();

      expect(await navigator.clipboard.readText()).toBe(token);
      expect(events).toEqual(["copy", "paste"]);
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": token })]);
      expect(events).toEqual(["copy", "paste", "copy"]);
      await navigator.clipboard.read();
      expect(events).toEqual(["copy", "paste", "copy", "paste"]);

      // Neither a rejected validation nor the empty no-op write fires.
      await expectDOMException(
        navigator.clipboard.write([new ClipboardItem({ "application/x-bun": "x" })]),
        "NotAllowedError",
      );
      await navigator.clipboard.write([]);
      expect(events).toEqual(["copy", "paste", "copy", "paste"]);
    } finally {
      navigator.clipboard.removeEventListener("copy", record);
      navigator.clipboard.removeEventListener("paste", record);
      navigator.clipboard.removeEventListener("cut", record);
      if (saved !== null) await navigator.clipboard.writeText(saved).catch(() => {});
    }
  });
});

describe("readText / writeText", () => {
  // Hermetic end-to-end coverage of the POSIX helper path (candidate
  // selection, Bun.spawn, the stdin/stdout plumbing): `xclip` is shadowed on
  // PATH by a stand-in that persists to a file, whose existence proves the
  // helper — not a native backend — served the round-trip. Linux-only because
  // `process.platform` is inlined at build time, so the helper branch does
  // not exist in macOS/Windows builds (they use the in-process pasteboard).
  test.skipIf(!isLinux)("the helper path round-trips through a PATH-shimmed xclip", async () => {
    using dir = tempDir("clipboard-helper", {
      "xclip": `#!/bin/sh\nif [ -z "$CLIP_STATE_FILE" ]; then exit 2; fi\ncase "$*" in\n  *-out*) if [ -f "$CLIP_STATE_FILE" ]; then cat "$CLIP_STATE_FILE"; fi ;;\n  *) cat > "$CLIP_STATE_FILE" ;;\nesac\n`,
      "main.js": `
        const { existsSync } = require("node:fs");
        const events = [];
        navigator.clipboard.addEventListener("copy", e => events.push(e.type));
        navigator.clipboard.addEventListener("paste", e => events.push(e.type));
        const token = "helper-path \\u2702 " + Date.now();
        await navigator.clipboard.writeText(token);
        const back = await navigator.clipboard.readText();
        console.log(JSON.stringify({ ok: back === token, helperRan: existsSync(process.env.CLIP_STATE_FILE), events }));
      `,
    });
    chmodSync(join(String(dir), "xclip"), 0o755);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        PATH: `${dir}:${bunEnv.PATH ?? process.env.PATH}`,
        DISPLAY: ":0",
        WAYLAND_DISPLAY: undefined,
        CLIP_STATE_FILE: join(String(dir), "clipboard-state.txt"),
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({
      stdout: JSON.stringify({ ok: true, helperRan: true, events: ["copy", "paste"] }),
      exitCode: 0,
    });
  });

  test("round-trips text, or rejects with NotAllowedError where there is no system clipboard", async () => {
    let saved: string | null = null;
    try {
      saved = await navigator.clipboard.readText();
    } catch (e) {
      // No reachable clipboard here (e.g. headless Linux with no display):
      // the spec'd failure is a "NotAllowedError" DOMException for both.
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe("NotAllowedError");
      await expectDOMException(navigator.clipboard.writeText("x"), "NotAllowedError");
      return;
    }
    try {
      // A unique token makes an unrelated process racing the system clipboard
      // a clear mismatch instead of a false pass.
      const token = `bun-clipboard-test ${Date.now()} ${Math.random()}`;
      expect(await navigator.clipboard.writeText(token)).toBeUndefined();
      expect(await navigator.clipboard.readText()).toBe(token);

      // Non-ASCII text must survive the platform round-trip byte-for-byte.
      const unicode = "héllo 🌍 — ünïcödé ✂️📋";
      await navigator.clipboard.writeText(unicode);
      expect(await navigator.clipboard.readText()).toBe(unicode);

      // WebIDL DOMString conversion: null becomes the string "null".
      await navigator.clipboard.writeText(null as unknown as string);
      expect(await navigator.clipboard.readText()).toBe("null");

      // Writing "" is legal, and readText() of an empty clipboard resolves "".
      await navigator.clipboard.writeText("");
      expect(await navigator.clipboard.readText()).toBe("");
    } finally {
      // Put the machine's text back so running this locally doesn't clobber
      // the developer's clipboard.
      if (saved !== null) await navigator.clipboard.writeText(saved).catch(() => {});
    }
  });
});
