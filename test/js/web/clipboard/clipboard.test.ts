// The async Clipboard API: https://w3c.github.io/clipboard-apis/
// The round-trip test is environment-adaptive: a machine with no reachable
// system clipboard must reject with a "NotAllowedError" DOMException instead.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

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
    expect(Object.keys(Clipboard.prototype)).toEqual(["readText", "writeText"]);
    expect(Clipboard.prototype.readText.length).toBe(0);
    expect(Clipboard.prototype.writeText.length).toBe(1);
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

  test("read()/write() are intentionally absent, not present-and-throwing", () => {
    // They need the unimplemented `ClipboardItem` interface; per WebIDL an
    // unimplemented operation is absent from the prototype.
    expect("read" in navigator.clipboard).toBe(false);
    expect("write" in navigator.clipboard).toBe(false);
    expect("ClipboardItem" in globalThis).toBe(false);
  });

  test("readText()/writeText() return Promises and reject (not throw) on a bad receiver", async () => {
    // WebIDL: a Promise-returning operation converts a failed brand check
    // into a rejection, never a synchronous throw.
    const detached = Clipboard.prototype.readText.call({} as Clipboard);
    expect(detached).toBeInstanceOf(Promise);
    await expect(detached).rejects.toThrow(TypeError);
    await expect(Clipboard.prototype.writeText.call({} as Clipboard, "x")).rejects.toThrow(TypeError);
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

  // WebIDL: the interface object is a writable property of the global, so
  // polyfills and test mocks can replace it. Last: it swaps the real class out.
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
        const token = "helper-path \\u2702 " + Date.now();
        await navigator.clipboard.writeText(token);
        const back = await navigator.clipboard.readText();
        console.log(JSON.stringify({ ok: back === token, helperRan: existsSync(process.env.CLIP_STATE_FILE) }));
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
      stdout: JSON.stringify({ ok: true, helperRan: true }),
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
      const writeError = await navigator.clipboard.writeText("x").then(
        () => null,
        (err: unknown) => err,
      );
      expect(writeError).toBeInstanceOf(DOMException);
      expect((writeError as DOMException).name).toBe("NotAllowedError");
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
