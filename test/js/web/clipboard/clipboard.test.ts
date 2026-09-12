// The async Clipboard API: https://w3c.github.io/clipboard-apis/
// The OS round-trip tests are environment-adaptive: a machine with no
// reachable system clipboard must reject with a "NotAllowedError"
// DOMException instead, and that shape is asserted.
import { dlopen, FFIType, ptr, toBuffer } from "bun:ffi";
import { heapStats } from "bun:jsc";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
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

// Several tests below land real OS writes on a machine with a reachable
// clipboard. Bracket the whole file so running it locally puts back whatever
// the developer had. `null` means no reachable clipboard, in which case
// nothing here reached the OS.
let savedClipboard: ClipboardItem[] | null = null;
beforeAll(async () => {
  savedClipboard = await navigator.clipboard.read().catch(() => null);
});
afterAll(async () => {
  if (savedClipboard === null) return;
  if (savedClipboard.length === 0) {
    await navigator.clipboard.writeText("").catch(() => {});
    return;
  }
  // read() packs every present representation into one item, but the POSIX
  // helper backends can only own one per write and reject a multi-rep item.
  // Fall back to the text so a browser copy (text/plain + text/html) survives.
  const restored = await navigator.clipboard.write(savedClipboard).then(
    () => true,
    () => false,
  );
  if (!restored && savedClipboard[0].types.includes("text/plain")) {
    const text = await savedClipboard[0]
      .getType("text/plain")
      .then(b => b.text())
      .catch(() => "");
    await navigator.clipboard.writeText(text).catch(() => {});
  }
});

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

  test("new Clipboard() throws a TypeError", () => {
    // Same wording as Bun's other non-constructable WebCore classes
    // (e.g. `new Performance()`).
    // @ts-expect-error: Clipboard has no public constructor.
    expect(() => new Clipboard()).toThrow(TypeError);
    // @ts-expect-error: Clipboard has no public constructor.
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
    // @ts-expect-error: writeText requires 1 argument.
    await expect(navigator.clipboard.writeText()).rejects.toThrow(TypeError);
    // The DOMString conversion of a Symbol throws before any platform code runs.
    await expect(navigator.clipboard.writeText(Symbol("x") as unknown as string)).rejects.toThrow(TypeError);
  });

  // The bytecode linker reifies bare globals before any statement runs, so
  // the `Clipboard` lookup-table entry must be materializable at link time.
  test("bare `Clipboard` identifier as the first statement of a process", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(Clipboard.prototype === navigator.clipboard.constructor.prototype)"],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `stderr` is unconstrained (debug builds emit benign warnings) but is
    // part of the asserted object so a failure diff shows it.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "true",
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // WebIDL: the interface objects are writable globals, so polyfills and test
  // mocks can replace them. Last in the suite: it swaps the real class out.
  test("globalThis.Clipboard is replaceable", () => {
    const original = Clipboard;
    try {
      // @ts-expect-error: intentionally assigning a non-Clipboard value.
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
    // WebIDL: the second constructor argument is optional.
    expect(ClipboardItem.length).toBe(1);
    const item = new ClipboardItem({ "text/plain": "hello" });
    expect(item).toBeInstanceOf(ClipboardItem);
    expect(Object.prototype.toString.call(item)).toBe("[object ClipboardItem]");
    expect(typeof ClipboardItem.supports).toBe("function");
  });

  test("constructor validates its arguments like the spec", () => {
    // @ts-expect-error: requires an items record.
    expect(() => new ClipboardItem()).toThrow(TypeError);
    expect(() => new ClipboardItem({})).toThrow(TypeError);
    expect(() => new ClipboardItem({ "not a mime": "x" })).toThrow(TypeError);
    expect(() => new ClipboardItem({ "text/plain": "x" }, { presentationStyle: "nope" as never })).toThrow(TypeError);
    // WebIDL: a non-null, non-undefined, non-object options dictionary throws.
    expect(() => new ClipboardItem({ "text/plain": "x" }, 42 as never)).toThrow(TypeError);
    expect(new ClipboardItem({ "text/plain": "x" }, null as never).presentationStyle).toBe("unspecified");
    // WebIDL record semantics: exotic (Proxy) records and non-enumerable keys.
    expect(new ClipboardItem(new Proxy({ "text/plain": "x" }, {})).types).toEqual(["text/plain"]);
    const items = Object.defineProperty({ "text/plain": "x" }, "not a mime", { value: "y", enumerable: false });
    expect(new ClipboardItem(items).types).toEqual(["text/plain"]);
    // mimesniff §4.4/§4.5: `types` reports the serialization of the parsed
    // MIME type, parameters included, as in Chrome.
    const parameterized = new ClipboardItem({ "Text/Plain; charset=utf-8": "x" });
    expect(parameterized.types).toEqual(["text/plain;charset=utf-8"]);
    const padded = new ClipboardItem({ " \ttext/plain\r\n": "y" });
    expect(padded.types).toEqual(["text/plain"]);
    // Only HTTP whitespace is trimmed (mimesniff section 4.4): a form feed is
    // not, so it stays in the type token and fails the token check. Inside
    // the parameters it makes that name invalid, dropping the parameter.
    expect(() => new ClipboardItem({ "\ftext/plain": "x" })).toThrow(TypeError);
    expect(ClipboardItem.supports("\ftext/plain")).toBe(false);
    expect(new ClipboardItem({ "text/plain;\fcharset=utf-8": "x" }).types).toEqual(["text/plain"]);
    // Distinct serializations are distinct representations.
    const twoReps = new ClipboardItem({ "text/plain": "a", "text/plain;charset=utf-8": "b" });
    expect(twoReps.types).toEqual(["text/plain", "text/plain;charset=utf-8"]);
    expect(() => new ClipboardItem({ "text/": "x" })).toThrow(TypeError);
    // Two spellings of one serialization are one representation, not two.
    expect(() => new ClipboardItem({ "text/plain": "a", " text/plain ": "b" })).toThrow(TypeError);
    // supports() matches by essence.
    expect(ClipboardItem.supports("text/plain;charset=utf-8")).toBe(true);
    // Spec "web " custom formats are not implemented. The error says so
    // instead of calling the key malformed.
    expect(() => new ClipboardItem({ "web text/csv": "a,b" })).toThrow(
      new TypeError('Web custom formats like "web text/csv" are not supported'),
    );
  });

  test("getType() matches by the parsed MIME essence", async () => {
    const item = new ClipboardItem({ " Text/Plain ; charset=utf-8": "essence" });
    expect(await (await item.getType("text/plain")).text()).toBe("essence");
    expect(await (await item.getType(" text/plain;charset=utf-8 ")).text()).toBe("essence");
  });

  // Two same-essence entries are stored distinctly, so each must stay
  // reachable: the exact serialization wins before the essence fallback.
  test("getType() prefers an exact serialization match over the essence", async () => {
    const twoReps = new ClipboardItem({ "text/plain": "a", "text/plain;charset=utf-8": "b" });
    expect(await (await twoReps.getType("text/plain")).text()).toBe("a");
    expect(await (await twoReps.getType(" Text/Plain ;charset=utf-8")).text()).toBe("b");
    // Platform formats carry no parameters, so writing both would silently
    // overwrite one; the write rejects before touching the OS.
    await expectDOMException(navigator.clipboard.write([twoReps]), "NotAllowedError");
  });

  test("MIME types are normalized to their lowercased serialization", async () => {
    const item = new ClipboardItem({ "TeXt/PlAiN": "upper" });
    expect(item.types).toEqual(["text/plain"]);
    expect(await (await item.getType("text/plain")).text()).toBe("upper");
    expect(await (await item.getType("TEXT/PLAIN")).text()).toBe("upper");
    expect(ClipboardItem.supports("TEXT/PLAIN")).toBe(true);
    // Two spellings of one type are one representation, not two.
    expect(() => new ClipboardItem({ "text/plain": "a", "TEXT/PLAIN": "b" })).toThrow(TypeError);
  });

  test("types is frozen and preserves insertion order; presentationStyle defaults", () => {
    const item = new ClipboardItem({ "text/plain": "a", "text/html": "<b>a</b>" }, { presentationStyle: "inline" });
    expect(item.types).toEqual(["text/plain", "text/html"]);
    expect(Object.isFrozen(item.types)).toBe(true);
    // WebIDL FrozenArray [SameObject]: the same JSArray on every get.
    expect(item.types).toBe(item.types);
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
    // Spec: getType() returns a Blob, not a File (and browsers agree). A File
    // input must not leak its File-ness or name through the dupe either.
    expect(plain).not.toBeInstanceOf(File);
    const fromFile = await new ClipboardItem({
      "text/plain": new File(["x"], "f.txt", { type: "text/plain" }),
    }).getType("text/plain");
    expect(fromFile).not.toBeInstanceOf(File);
    expect((fromFile as File).name).toBeUndefined();
    expect(plain.type).toBe("text/plain;charset=utf-8");
    expect(await plain.text()).toBe("as a string");
    const html = await item.getType("text/html");
    expect(await html.text()).toBe("<b>as a promise</b>");
    expect(html.type).toBe("text/html;charset=utf-8");
    const png = await item.getType("image/png");
    expect(png.type).toBe("image/png");
    expect(Buffer.from(await png.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  // The reaction getType() installs must keep the item (and so its stored
  // DOMPromise) alive until the representation settles; otherwise a temporary
  // item is collected first and the await spuriously rejects.
  test("an in-flight getType() keeps its item alive across GC", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const pending = new ClipboardItem({ "text/plain": promise }).getType("text/plain");
    Bun.gc(true);
    Bun.gc(true);
    resolve("survived");
    const blob = await pending;
    expect(await blob.text()).toBe("survived");
  });

  test("getType() of an absent type rejects with a NotFoundError DOMException", async () => {
    const item = new ClipboardItem({ "text/plain": "x" });
    await expectDOMException(item.getType("image/png"), "NotFoundError");
    // The message names the type that was missing.
    await expect(item.getType("image/png")).rejects.toThrow('"image/png"');
  });

  test("getType() forwards the representation's own rejection reason", async () => {
    // Same reason write() surfaces for the same failure, rather than a
    // flattened AbortError.
    const item = new ClipboardItem({ "text/plain": Promise.reject(new Error("nope")) });
    await expect(item.getType("text/plain")).rejects.toThrow("nope");
  });

  // WebIDL `(DOMString or Blob)`: a non-Blob fulfillment value is ToString'd
  // (so `42` → `"42"`, `null` → `"null"`); only uncoercible values reject.
  test("getType() coerces non-Blob, non-string data with ToString per WebIDL", async () => {
    const item = new ClipboardItem({
      "text/plain": 42 as never,
      "text/html": Promise.resolve(true) as never,
      "application/json": { toString: () => '{"a":1}' } as never,
    });
    expect(await (await item.getType("text/plain")).text()).toBe("42");
    expect(await (await item.getType("text/html")).text()).toBe("true");
    expect(await (await item.getType("application/json")).text()).toBe('{"a":1}');
    // `null` / `undefined` stringify; a Symbol (the one value ToString cannot
    // convert) rejects, as does a `toString` that throws.
    expect(await (await new ClipboardItem({ "text/plain": null as never }).getType("text/plain")).text()).toBe("null");
    await expect(new ClipboardItem({ "text/plain": Symbol("x") as never }).getType("text/plain")).rejects.toThrow(
      TypeError,
    );
    const throwing = {
      toString() {
        throw new Error("nope");
      },
    };
    await expect(new ClipboardItem({ "text/plain": throwing as never }).getType("text/plain")).rejects.toThrow("nope");
  });

  test("supports() tells the per-platform truth and coerces per WebIDL", () => {
    expect(ClipboardItem.supports("text/plain")).toBe(true);
    expect(ClipboardItem.supports("image/png")).toBe(true);
    expect(ClipboardItem.supports("text/html")).toBe(true);
    expect(ClipboardItem.supports("application/x-bun-custom")).toBe(false);
    // Browsers answer true for a spec "web " custom format because they can
    // write one. Bun cannot, so it does not claim to.
    expect(ClipboardItem.supports("web text/html")).toBe(false);
    expect(ClipboardItem.supports("web application/x-bun-custom")).toBe(false);
    // WebIDL DOMString conversion: stringifiable objects work, Symbols throw,
    // and the argument is required.
    expect(ClipboardItem.supports({ toString: () => "text/plain" } as unknown as string)).toBe(true);
    expect(() => ClipboardItem.supports(Symbol("x") as unknown as string)).toThrow(TypeError);
    // @ts-expect-error: the argument is required.
    expect(() => ClipboardItem.supports()).toThrow(TypeError);
  });

  test("accessors brand-check their receiver", () => {
    const proto = ClipboardItem.prototype;
    expect(() => Object.getOwnPropertyDescriptor(proto, "types")!.get!.call({})).toThrow(TypeError);
    expect(() => Object.getOwnPropertyDescriptor(proto, "presentationStyle")!.get!.call({})).toThrow(TypeError);
  });

  // Regression for JSClipboardItem missing its destroy() method-table entry:
  // without it GC swept the wrapper but never ran ~JSClipboardItem, so the
  // impl's DOMPromise stayed in guardedObjects and pinned its JSPromise.
  test("collected wrappers release their impl", () => {
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.Promise || 0;
    for (let i = 0; i < 2000; i++) new ClipboardItem({ "text/plain": "x" });
    Bun.gc(true);
    Bun.gc(true);
    const after = heapStats().objectTypeCounts.Promise || 0;
    // Each leaked impl pinned one Promise; without destroy() this grew by ~2000.
    expect(after - before).toBeLessThan(200);
  });
});

describe("ClipboardEvent", () => {
  test("is a constructible Event subclass that can be dispatched synthetically", () => {
    expect(typeof ClipboardEvent).toBe("function");
    expect(Object.getPrototypeOf(ClipboardEvent.prototype)).toBe(Event.prototype);
    // WebIDL: the event-init argument is optional.
    expect(ClipboardEvent.length).toBe(1);
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
    // @ts-expect-error: a type argument is required.
    expect(() => new ClipboardEvent()).toThrow(TypeError);
    const get = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, "clipboardData")!.get!;
    expect(() => get.call(new Event("copy"))).toThrow(TypeError);
  });
});

describe("read / write", () => {
  // Everything here rejects during validation, before any OS access, so it is
  // deterministic on every platform including headless CI.
  test("write() argument validation follows the spec, before touching the OS", async () => {
    // @ts-expect-error: write requires 1 argument.
    await expect(navigator.clipboard.write()).rejects.toThrow(TypeError);
    await expect(navigator.clipboard.write(123 as never)).rejects.toThrow(TypeError);
    await expect(navigator.clipboard.write([{} as ClipboardItem])).rejects.toThrow(TypeError);

    const a = new ClipboardItem({ "text/plain": "a" });
    const b = new ClipboardItem({ "text/plain": "b" });
    await expectDOMException(navigator.clipboard.write([a, b]), "NotAllowedError");

    // An unsupported representation rejects the write, including when the
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

    // A ClipboardItemData that rejects propagates as the write's rejection,
    // and an uncoercible settled value rejects there too.
    await expect(
      navigator.clipboard.write([new ClipboardItem({ "text/plain": Promise.reject(new Error("boom")) })]),
    ).rejects.toThrow("boom");
    await expect(
      navigator.clipboard.write([new ClipboardItem({ "text/plain": Promise.resolve(Symbol("x")) as never })]),
    ).rejects.toThrow(TypeError);
  });

  // The rejections a caller can act on say what was wrong. All of these are
  // decided before the OS clipboard is involved, so they are the same
  // everywhere except the per-item limit, which only the one-shot POSIX
  // helpers have.
  test("write() rejections name the problem", async () => {
    const rejection = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        (e: DOMException) => `${e.name}: ${e.message}`,
      );
    using fileDir = tempDir("clipboard-messages", {});
    const singleRepresentation = !isMacOS && !isWindows;
    // Marked handled up front: where the per-item limit applies it is never collected.
    const neverCollected = Promise.reject(new Error("never collected"));
    neverCollected.catch(() => {});
    const outcomes = {
      twoItems: await rejection(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "a" }), new ClipboardItem({ "text/plain": "b" })]),
      ),
      unsupportedType: await rejection(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "a", "application/x-bun": "b" })]),
      ),
      sameEssenceTwice: await rejection(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "a", "text/plain;charset=utf-8": "b" })]),
      ),
      unreadableFile: await rejection(
        navigator.clipboard.write([
          new ClipboardItem({ "text/plain": Bun.file(join(String(fileDir), "missing.txt")) }),
        ]),
      ),
      twoRepresentations: await rejection(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "a", "text/html": neverCollected })]),
      ),
    };
    expect(outcomes).toEqual({
      twoItems: "NotAllowedError: Writing multiple ClipboardItems is not supported.",
      unsupportedType: 'NotAllowedError: The type "application/x-bun" is not supported on this platform.',
      sameEssenceTwice: 'NotAllowedError: Writing two "text/plain" representations is not supported.',
      // The read error is passed through once, not re-prefixed with its code.
      unreadableFile: expect.stringMatching(
        /^NotAllowedError: ENOENT: no such file or directory, open '.*missing\.txt'$/,
      ),
      // Where items can hold several representations the rejection comes from
      // collecting them (the rejected representation's own reason), proving
      // the per-item limit is not applied there.
      twoRepresentations: singleRepresentation
        ? "NotAllowedError: Writing more than one representation per item is not supported on this platform."
        : "Error: never collected",
    });
  });

  // A file-backed Blob (Bun.file) has no resident bytes; the writer reads it
  // in before the platform transaction instead of rejecting it.
  test("write() reads file-backed representations in; a missing file rejects", async () => {
    using fileDir = tempDir("clipboard-file-blob", { "a.txt": "from disk" });
    // The read failure arrives before any platform access, so this arm is
    // deterministic even with no reachable clipboard.
    await expectDOMException(
      navigator.clipboard.write([new ClipboardItem({ "text/plain": Bun.file(join(String(fileDir), "missing.txt")) })]),
      "NotAllowedError",
    );
    const write = navigator.clipboard.write([
      new ClipboardItem({ "text/plain": Bun.file(join(String(fileDir), "a.txt")) }),
    ]);
    if (savedClipboard === null) {
      await expectDOMException(write, "NotAllowedError");
      return;
    }
    await write;
    expect(await navigator.clipboard.readText()).toBe("from disk");
  });

  // Spec: getType() resolves the representation's Blob ("resolve p with v");
  // a file-backed one passes through lazily, even when its declared type
  // differs from the representation's key.
  test("getType() passes file-backed Blobs through as lazy Blobs", async () => {
    using fileDir = tempDir("clipboard-file-gettype", { "a.txt": "lazy bytes" });
    const item = new ClipboardItem({ "text/html": Bun.file(join(String(fileDir), "a.txt")) });
    const blob = await item.getType("text/html");
    expect(blob).not.toBeInstanceOf(File);
    // The lazy dupe reports the requested type, like the resident re-wrap
    // path, not the source file's extension-inferred one.
    expect(blob.type).toBe("text/html");
    expect(await blob.text()).toBe("lazy bytes");
  });

  // Regression: the write's data source holds only a WeakPtr back-edge to its
  // item, so the ItemWriter has to own the items. Without that, an item whose
  // representation never settles is collected mid-write and destroys its data
  // source with the collect completion still armed: a debug assert, and a
  // permanently pending promise in release.
  test("an in-flight write keeps its item alive across GC", async () => {
    // No reference to the item survives this statement; only the writer holds
    // it. Resolve the representation *after* GC so the assertion is that the
    // write still completes, a symptom visible in release, unlike "still
    // pending", which is also what the bug looks like.
    const { promise: rep, resolve } = Promise.withResolvers<string>();
    const write = navigator.clipboard.write([new ClipboardItem({ "text/plain": rep })]);
    Bun.gc(true);
    Bun.gc(true);
    resolve("survived");
    // Settles either way (a machine with no clipboard rejects NotAllowedError);
    // what must not happen is hanging forever because the item was collected.
    const outcome = await write.then(
      () => "settled",
      e => (e as Error).name,
    );
    expect(["settled", "NotAllowedError"]).toContain(outcome);
  });

  // writeText() must supersede an in-flight write() the same way write() does,
  // or the earlier write lands after and overwrites.
  test("writeText() supersedes an in-flight write()", async () => {
    const { promise: rep } = Promise.withResolvers<string>();
    const first = navigator.clipboard.write([new ClipboardItem({ "text/plain": rep })]);
    navigator.clipboard.writeText("later").catch(() => {});
    await expectDOMException(first, "AbortError");
  });

  // Per spec (and Chrome), write([]) resolves without touching (or clearing)
  // the clipboard.
  test("write([]) resolves and leaves the clipboard contents alone", async () => {
    if (savedClipboard === null) {
      // Nothing is ever written, so this resolves even with no clipboard.
      await navigator.clipboard.write([]);
      return;
    }
    await navigator.clipboard.writeText("kept");
    await navigator.clipboard.write([]);
    expect(await navigator.clipboard.readText()).toBe("kept");
  });

  // write([]) resolves without reaching the OS, but it is still a write() call
  // and must abort an in-flight write() rather than letting it land later.
  test("write([]) supersedes an in-flight write()", async () => {
    const { promise: rep } = Promise.withResolvers<string>();
    const first = navigator.clipboard.write([new ClipboardItem({ "text/plain": rep })]);
    await navigator.clipboard.write([]);
    await expectDOMException(first, "AbortError");
  });

  // An aborted write's platform job must be cancelled too, or the "aborted"
  // write still reaches the OS. The two jobs run on whichever pool threads
  // pick them up, so this holds only because the backend checks the flag
  // under the lock it writes under.
  test("a superseded write never lands after its successor", async () => {
    if (savedClipboard === null) {
      await expectDOMException(navigator.clipboard.writeText("A"), "NotAllowedError");
      await expectDOMException(navigator.clipboard.read(), "NotAllowedError");
      return;
    }
    for (let i = 0; i < 10; i++) {
      // A platform-sourced item collects synchronously, so the platform write
      // is already queued when writeText() supersedes it.
      await navigator.clipboard.writeText(`A${i}`);
      const [itemA] = await navigator.clipboard.read();
      const aborted = navigator.clipboard.write([itemA]).then(
        () => "resolved",
        (e: Error) => e.name,
      );
      await navigator.clipboard.writeText(`B${i}`);
      expect(await aborted).toBe("AbortError");
      expect(await navigator.clipboard.readText()).toBe(`B${i}`);
    }
  });

  // collectDataForWriting() calls the realm's Promise.all, which user JS can
  // tamper to synchronously re-enter write([sameItem]); the outer frame must
  // not then touch the newer writer's armed state when it resumes.
  test("a write re-entered from a tampered Promise.all does not clobber the inner one", async () => {
    const realAll = Promise.all;
    let inner: Promise<void> | null = null;
    const item = new ClipboardItem({ "text/plain": "ok" });
    (Promise as any).all = function () {
      Promise.all = realAll;
      inner = navigator.clipboard.write([item]);
      return undefined;
    };
    try {
      await expectDOMException(navigator.clipboard.write([item]), "AbortError");
      expect(inner).not.toBeNull();
      const outcome = await inner!.then(
        () => "ok",
        (e: Error) => e.message,
      );
      // Without the generation guard the outer frame fires the inner writer's
      // completion with nullopt, which rejects with this exact message.
      expect(outcome).not.toContain("representation could not be read");
    } finally {
      Promise.all = realAll;
      // Retire the tail write so nothing is in flight for the next test.
      await navigator.clipboard.write([]);
    }
  });

  // Regression: a superseded writer must retire the collect still armed on its
  // items. The collect completion holds a Ref back to the writer, so dropping
  // the items without retiring leaves writer, item and the GC-guarded
  // aggregate promise (which pins the user's promise) alive for good.
  test("a superseded write releases its items and their promises", async () => {
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 300; i++) {
      const stuck = new Promise<string>(() => {});
      refs.push(new WeakRef(stuck));
      // Each iteration supersedes the previous writer, which never settles.
      navigator.clipboard.write([new ClipboardItem({ "text/plain": stuck })]).catch(() => {});
    }
    for (let i = 0; i < 5; i++) Bun.gc(true);
    const live = refs.filter(r => r.deref() !== undefined).length;
    // The most recent writer legitimately still holds its item; everything
    // before it must be collectable.
    expect(live).toBeLessThan(20);
  });

  // Regression: `copy` listeners run synchronously from the finishing write, so
  // a listener that starts another write over the same item used to have its
  // freshly-armed collect retired by the writer that was tearing down.
  test("a write started from a copy listener is not cancelled by the one that fired it", async () => {
    const item = new ClipboardItem({ "text/plain": new Blob(["nested"], { type: "text/plain" }) });
    let nested: Promise<void> | null = null;
    const onCopy = () => {
      if (!nested) nested = navigator.clipboard.write([item]);
    };
    navigator.clipboard.addEventListener("copy", onCopy);
    try {
      const outer = navigator.clipboard.write([item]);
      await outer.catch(() => {});
      if (!nested) {
        // No copy event ⇔ no reachable clipboard: the write must have rejected.
        await expectDOMException(outer, "NotAllowedError");
        return;
      }
      const outcome = await nested.then(
        () => "settled",
        (e: Error) => e.name,
      );
      expect(["settled", "NotAllowedError"]).toContain(outcome);
    } finally {
      navigator.clipboard.removeEventListener("copy", onCopy);
    }
  });

  test("round-trips representations, or rejects with NotAllowedError where there is no clipboard", async () => {
    if (savedClipboard === null) {
      // No reachable clipboard (e.g. headless Linux): read() and write()
      // must fail with the same spec'd shape.
      await expectDOMException(navigator.clipboard.read(), "NotAllowedError");
      await expectDOMException(
        navigator.clipboard.write([new ClipboardItem({ "text/plain": "x" })]),
        "NotAllowedError",
      );
      return;
    }
    // A unique token makes an unrelated process racing the clipboard a
    // visible mismatch instead of a false pass. Multi-representation items
    // are native-only: the POSIX helpers can hold one representation.
    const token = `bun clipboard read/write ${Date.now()} ${Math.random()}`;
    const types: Record<string, string | Blob> = { "text/plain": token };
    const multiRep = process.platform === "darwin" || process.platform === "win32";
    const withHtml = multiRep && ClipboardItem.supports("text/html");
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

    // Binary representations survive the platform round-trip byte-exact (on
    // Windows that means the backend trims GlobalSize's rounding off the PNG).
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([PNG_1X1], { type: "image/png" }) })]);
    const [imageItem] = await navigator.clipboard.read();
    expect(imageItem.types).toEqual(["image/png"]);
    expect(Buffer.from(await (await imageItem.getType("image/png")).arrayBuffer())).toEqual(PNG_1X1);
  });
});

describe("clipboard events", () => {
  // Bun's projection of the spec's clipboard actions onto a runtime: writes
  // that place data fire "copy", successful reads fire "paste" (both at
  // `navigator.clipboard`), failures fire nothing, and "cut" never auto-fires.
  test("copy/paste fire at navigator.clipboard on success, and only on success", async () => {
    const unavailable = savedClipboard === null;
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
        // With no reachable clipboard every operation rejects, and a failed
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
    }
  });
});

describe("readText / writeText", () => {
  test("round-trips text, or rejects with NotAllowedError where there is no system clipboard", async () => {
    if (savedClipboard === null) {
      // No reachable clipboard here (e.g. headless Linux with no display):
      // the spec'd failure is a "NotAllowedError" DOMException for both.
      await expectDOMException(navigator.clipboard.readText(), "NotAllowedError");
      await expectDOMException(navigator.clipboard.writeText("x"), "NotAllowedError");
      return;
    }
    // A unique token makes an unrelated process racing the system clipboard
    // a clear mismatch instead of a false pass.
    const token = `bun-clipboard-test ${Date.now()} ${Math.random()}`;
    expect(await navigator.clipboard.writeText(token)).toBeUndefined();
    expect(await navigator.clipboard.readText()).toBe(token);

    // Non-ASCII text must survive the platform round-trip byte-for-byte.
    const unicode = "héllo 🌍 — ünïcödé ✂️📋";
    await navigator.clipboard.writeText(unicode);
    expect(await navigator.clipboard.readText()).toBe(unicode);

    // Spec note on writeText: Windows converts bare LF to CRLF for
    // CF_UNICODETEXT; other platforms write the text byte-for-byte.
    await navigator.clipboard.writeText("line1\nline2\r\nline3");
    expect(await navigator.clipboard.readText()).toBe(
      process.platform === "win32" ? "line1\r\nline2\r\nline3" : "line1\nline2\r\nline3",
    );

    // WebIDL DOMString conversion: null becomes the string "null".
    await navigator.clipboard.writeText(null as unknown as string);
    expect(await navigator.clipboard.readText()).toBe("null");

    // Writing "" is legal, and readText() of an empty clipboard resolves "".
    await navigator.clipboard.writeText("");
    expect(await navigator.clipboard.readText()).toBe("");
    // An empty text/plain representation is present, not absent: `read()`
    // resolves `[ClipboardItem]` with a 0-byte text/plain Blob, like browsers.
    const emptyItems = await navigator.clipboard.read();
    expect(emptyItems).toHaveLength(1);
    expect(emptyItems[0].types).toContain("text/plain");
    expect(await (await emptyItems[0].getType("text/plain")).text()).toBe("");
  });
});

// The POSIX backend has no clipboard API to call: it runs `wl-paste`/`wl-copy`,
// `xclip` or `xsel` and has to make sense of whatever they do. CI has no
// display, so stand-ins on PATH play the helpers, which also makes every
// failure mode below reproducible. Each test is its own child process with
// its own directory, so they run concurrently.
type Helper = "xclip" | "xsel" | "wl-paste" | "wl-copy";
const HELPERS: Helper[] = ["xclip", "xsel", "wl-paste", "wl-copy"];

const NO_DISPLAY =
  "NotAllowedError: The clipboard requires a Wayland or X11 display, but neither $WAYLAND_DISPLAY nor $DISPLAY is set.";
const NO_HELPER =
  "NotAllowedError: No clipboard helper was found. Install `wl-clipboard` (Wayland), `xclip`, or `xsel` (X11).";
const HELPER_FAILED = "NotAllowedError: The clipboard helper program failed to access the clipboard.";

// Available to every child script: settle a promise into something JSON can
// carry, read what a stand-in recorded, and print the one line the test reads.
const CHILD_PRELUDE = `
  const { readFileSync, readdirSync } = require("node:fs");
  const CLIP_DIR = process.env.CLIP_DIR;
  const settle = (promise, map = value => value) =>
    promise.then(async value => ({ ok: await map(value) }), e => ({ error: e.name + ": " + e.message }));
  const types = items => items.map(item => [...item.types]);
  const received = name => readFileSync(CLIP_DIR + "/" + name, "utf8");
  const leftovers = () => readdirSync(process.env.TMPDIR);
  const print = value => console.log(JSON.stringify(value));
`;

// Runs `script` in a child whose PATH starts with a directory of stand-ins for
// the four helpers. A stand-in appends "<name> <args>" to a log and then runs
// its sh `body`; a helper given no body exits 127, which is what sh reports
// for a program that is not installed. The child sees the directory as
// $CLIP_DIR, and $TMPDIR (where writes stage their payload) is a subdirectory
// whose name needs quoting. Returns the child's JSON line and the log.
async function runWithHelpers(
  bodies: Partial<Record<Helper, string>>,
  script: string,
  env: Record<string, string | undefined> = {},
  extraFiles: Record<string, string> = {},
) {
  const files: Record<string, string | Record<string, never>> = {
    ...extraFiles,
    "main.js": CHILD_PRELUDE + script,
    "tmp 'dir'": {},
  };
  for (const helper of HELPERS) {
    files[helper] =
      `#!/bin/sh\nprintf '%s\\n' "$(basename "$0") $*" >> "$CLIP_DIR/log"\n${bodies[helper] ?? "exit 127"}\n`;
  }
  using dir = tempDir("clipboard-helpers", files);
  for (const helper of HELPERS) chmodSync(join(String(dir), helper), 0o755);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      PATH: `${dir}:${bunEnv.PATH ?? process.env.PATH}`,
      DISPLAY: ":0",
      WAYLAND_DISPLAY: undefined,
      CLIP_DIR: String(dir),
      TMPDIR: join(String(dir), "tmp 'dir'"),
      ...env,
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`child exited with ${exitCode}\n${stderr}\n${stdout}`);
  const logPath = join(String(dir), "log");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8").trimEnd().split("\n") : [];
  return { result: JSON.parse(stdout), log };
}

describe.concurrent.skipIf(!isLinux)("POSIX helper backend", () => {
  test("round-trips through a helper, firing copy/paste; an empty text/plain is present", async () => {
    const { result, log } = await runWithHelpers(
      {
        xclip: `case "$*" in *-out*) cat "$CLIP_DIR/state" ;; *) cat > "$CLIP_DIR/state" ;; esac`,
      },
      `
        const events = [];
        navigator.clipboard.addEventListener("copy", e => events.push(e.type));
        navigator.clipboard.addEventListener("paste", e => events.push(e.type));
        const token = "helper path \\u2702 " + Date.now();
        await navigator.clipboard.writeText(token);
        const back = await navigator.clipboard.readText();
        await navigator.clipboard.writeText("");
        print({ roundTripped: back === token, emptyTypes: types(await navigator.clipboard.read()), events });
      `,
    );
    expect({ result, log }).toEqual({
      result: { roundTripped: true, emptyTypes: [["text/plain"]], events: ["copy", "paste", "copy", "paste"] },
      log: [
        "xclip -selection clipboard -in",
        "xclip -selection clipboard -out",
        "xclip -selection clipboard -in",
        // read() probes every supported type; html and png come back empty,
        // which for them means absent.
        "xclip -selection clipboard -out",
        "xclip -selection clipboard -t text/html -out",
        "xclip -selection clipboard -t image/png -out",
      ],
    });
  });

  test("without a display nothing is spawned and every method says which variable is missing", async () => {
    const { result, log } = await runWithHelpers(
      { xclip: "printf must-not-run", xsel: "printf must-not-run" },
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          read: await settle(navigator.clipboard.read()),
          writeText: await settle(navigator.clipboard.writeText("x")),
          write: await settle(navigator.clipboard.write([new ClipboardItem({ "text/plain": "x" })])),
          leftovers: leftovers(),
        });
      `,
      // An empty $DISPLAY counts as unset.
      { DISPLAY: "" },
    );
    expect({ result, log }).toEqual({
      result: {
        readText: { error: NO_DISPLAY },
        read: { error: NO_DISPLAY },
        writeText: { error: NO_DISPLAY },
        write: { error: NO_DISPLAY },
        leftovers: [],
      },
      log: [],
    });
  });

  test("with a display but nothing installed, the rejection says what to install", async () => {
    const { result, log } = await runWithHelpers(
      {},
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          read: await settle(navigator.clipboard.read()),
          writeText: await settle(navigator.clipboard.writeText("x")),
          write: await settle(navigator.clipboard.write([new ClipboardItem({ "text/html": "<b>x</b>" })])),
          leftovers: leftovers(),
        });
      `,
      // Both displays, so every Wayland and X11 candidate is tried; the
      // stand-ins report "not installed" the way sh does for a missing program.
      { WAYLAND_DISPLAY: "wayland-0" },
    );
    expect({ result, log }).toEqual({
      result: {
        readText: { error: NO_HELPER },
        read: { error: NO_HELPER },
        writeText: { error: NO_HELPER },
        write: { error: NO_HELPER },
        // The staged payload is removed even though no helper consumed it.
        leftovers: [],
      },
      log: [
        "wl-paste --no-newline --type text",
        "xclip -selection clipboard -out",
        "xsel --clipboard --output",
        "wl-paste --no-newline --type text",
        "xclip -selection clipboard -out",
        "xsel --clipboard --output",
        "wl-paste --no-newline --type text/html",
        "xclip -selection clipboard -t text/html -out",
        "wl-paste --no-newline --type image/png",
        "xclip -selection clipboard -t image/png -out",
        "wl-copy --type text/plain;charset=utf-8",
        "xclip -selection clipboard -in",
        "xsel --clipboard --input",
        "wl-copy --type text/html",
        "xclip -selection clipboard -t text/html -in",
      ],
    });
  });

  // sh's own "not found" exit for the helper, with nothing else on PATH either:
  // the watchdog, whose `sleep` is missing too, must not turn that into a
  // kill (which would report a failed helper instead of a missing one).
  test("a genuinely empty PATH also reads as nothing installed", async () => {
    const { result, log } = await runWithHelpers(
      { xclip: "printf must-not-run" },
      `print({ readText: await settle(navigator.clipboard.readText()), writeText: await settle(navigator.clipboard.writeText("x")) });`,
      { PATH: "/nonexistent/clipboard-helpers" },
    );
    expect({ result, log }).toEqual({
      result: { readText: { error: NO_HELPER }, writeText: { error: NO_HELPER } },
      log: [],
    });
  });

  test("Wayland helpers are preferred, X11 ones are the fallback, and read() is best-effort per type", async () => {
    const { result, log } = await runWithHelpers(
      {
        // wl-paste is "not installed" (no body), so reads fall through to xclip,
        // which serves text, has nothing for html (exit 0, no output) and
        // crashes on png. wl-copy is installed, so writes never reach xclip.
        xclip: `case "$*" in *image/png*) kill -KILL $$ ;; *text/html*) exit 0 ;; *) printf 'from xclip' ;; esac`,
        xsel: "printf 'from xsel'",
        "wl-copy": `cat > "$CLIP_DIR/wl-copy-received"`,
      },
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          read: await settle(navigator.clipboard.read(), types),
          writeText: await settle(navigator.clipboard.writeText("hello"), () => received("wl-copy-received")),
          writeHtml: await settle(
            navigator.clipboard.write([new ClipboardItem({ "text/html": "<b>hi</b>" })]),
            () => received("wl-copy-received"),
          ),
          leftovers: leftovers(),
        });
      `,
      { WAYLAND_DISPLAY: "wayland-0" },
    );
    expect({ result, log }).toEqual({
      result: {
        readText: { ok: "from xclip" },
        // The crashed png probe does not fail the read; that type is just absent.
        read: { ok: [["text/plain"]] },
        writeText: { ok: "hello" },
        writeHtml: { ok: "<b>hi</b>" },
        leftovers: [],
      },
      log: [
        "wl-paste --no-newline --type text",
        "xclip -selection clipboard -out",
        "wl-paste --no-newline --type text",
        "xclip -selection clipboard -out",
        "wl-paste --no-newline --type text/html",
        "xclip -selection clipboard -t text/html -out",
        "wl-paste --no-newline --type image/png",
        "xclip -selection clipboard -t image/png -out",
        "wl-copy --type text/plain;charset=utf-8",
        "wl-copy --type text/html",
      ],
    });
  });

  test("a helper exiting non-zero means nothing is copied, and fails a write", async () => {
    const { result, log } = await runWithHelpers(
      { xclip: "exit 1", xsel: "exit 1" },
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          read: await settle(navigator.clipboard.read(), types),
          writeText: await settle(navigator.clipboard.writeText("x")),
          leftovers: leftovers(),
        });
      `,
    );
    expect({ result, log }).toEqual({
      result: {
        readText: { ok: "" },
        read: { ok: [] },
        writeText: { error: HELPER_FAILED },
        leftovers: [],
      },
      log: [
        "xclip -selection clipboard -out",
        "xsel --clipboard --output",
        "xclip -selection clipboard -out",
        "xsel --clipboard --output",
        "xclip -selection clipboard -t text/html -out",
        "xclip -selection clipboard -t image/png -out",
        "xclip -selection clipboard -in",
        "xsel --clipboard --input",
      ],
    });
  });

  test("a helper that dies is skipped in favor of the next candidate", async () => {
    const { result, log } = await runWithHelpers(
      {
        xclip: "kill -TERM $$",
        xsel: `case "$*" in *--output*) printf 'from xsel' ;; *) cat > "$CLIP_DIR/xsel-received" ;; esac`,
      },
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          writeText: await settle(navigator.clipboard.writeText("via xsel"), () => received("xsel-received")),
        });
      `,
    );
    expect({ result, log }).toEqual({
      result: { readText: { ok: "from xsel" }, writeText: { ok: "via xsel" } },
      log: [
        "xclip -selection clipboard -out",
        "xsel --clipboard --output",
        "xclip -selection clipboard -in",
        "xsel --clipboard --input",
      ],
    });
  });

  test("when every candidate dies the failure is reported and nothing is left behind", async () => {
    const { result } = await runWithHelpers(
      { xclip: "kill -KILL $$", xsel: "kill -KILL $$" },
      `
        print({
          readText: await settle(navigator.clipboard.readText()),
          read: await settle(navigator.clipboard.read()),
          writeText: await settle(navigator.clipboard.writeText("x")),
          writeHtml: await settle(navigator.clipboard.write([new ClipboardItem({ "text/html": "<b>x</b>" })])),
          leftovers: leftovers(),
        });
      `,
    );
    expect(result).toEqual({
      readText: { error: HELPER_FAILED },
      read: { error: HELPER_FAILED },
      writeText: { error: HELPER_FAILED },
      writeHtml: { error: HELPER_FAILED },
      leftovers: [],
    });
  });

  test("the watchdog kills a helper that hangs and the operation fails", async () => {
    const { result, log } = await runWithHelpers(
      // A hung selection owner: the helper records its pid and never returns.
      { xclip: `echo $$ > "$CLIP_DIR/helper-pid"; exec sleep 30` },
      `
        const started = performance.now();
        const readText = await settle(navigator.clipboard.readText());
        const waitedForWatchdog = performance.now() - started >= 900;
        let helperStillRunning = true;
        try {
          process.kill(Number(received("helper-pid")), 0);
        } catch {
          helperStillRunning = false;
        }
        print({ readText, waitedForWatchdog, helperStillRunning });
      `,
      { BUN_INTERNAL_CLIPBOARD_HELPER_TIMEOUT: "1" },
    );
    expect({ result, log }).toEqual({
      result: { readText: { error: HELPER_FAILED }, waitedForWatchdog: true, helperStillRunning: false },
      log: ["xclip -selection clipboard -out", "xsel --clipboard --output"],
    });
  });

  test("writes stage the payload in a private temp file the helper reads, removed afterwards", async () => {
    const { result, log } = await runWithHelpers(
      {
        // What the helper sees on stdin is the staged file itself.
        xclip: [
          `readlink /proc/self/fd/0 > "$CLIP_DIR/staged-path"`,
          `stat -L -c %a /proc/self/fd/0 > "$CLIP_DIR/staged-mode"`,
          `case "$*" in *image/png*) cat > "$CLIP_DIR/received-png" ;; *) cat > "$CLIP_DIR/received-text" ;; esac`,
        ].join("\n"),
      },
      `
        const { basename, dirname } = require("node:path");
        const text = "it's \\"quoted\\"\\n\\\\ back\\tslash \\u00e9";
        await navigator.clipboard.writeText(text);
        const textOk = received("received-text") === text;
        const stagedPath = received("staged-path").trim();
        const stagedMode = received("staged-mode").trim();
        const png = Buffer.from(${JSON.stringify(PNG_1X1.toString("base64"))}, "base64");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })]);
        const pngOk = readFileSync(CLIP_DIR + "/received-png").equals(png);
        print({
          textOk,
          pngOk,
          stagedInTmpdir: dirname(stagedPath) === process.env.TMPDIR,
          stagedName: basename(stagedPath),
          stagedMode,
          leftovers: leftovers(),
        });
      `,
    );
    expect({ result, log }).toEqual({
      result: {
        textOk: true,
        pngOk: true,
        stagedInTmpdir: true,
        stagedName: expect.stringMatching(/\.bun-clipboard$/),
        stagedMode: "600",
        leftovers: [],
      },
      log: ["xclip -selection clipboard -in", "xclip -selection clipboard -t image/png -in"],
    });
  });

  // Regression: a VM torn down with an op in flight. The worker's teardown
  // waits for the helper (released here right after terminate()), then drops
  // the job's completion unrun, which has to release the request's promise on
  // the worker's own thread. Any fault on that path aborts the child (debug
  // assertions, ASAN) instead of exiting 0; the parent's own write afterwards
  // shows the backend is still usable, and the orphaned write still removed
  // its staged file.
  test("terminating a worker with a write in flight releases the op cleanly", async () => {
    const { result, log } = await runWithHelpers(
      {
        xclip: [
          `: > "$CLIP_DIR/helper-started"`,
          `until [ -e "$CLIP_DIR/release" ]; do sleep 0.02; done`,
          `cat > /dev/null`,
        ].join("\n"),
      },
      `
        const { existsSync, writeFileSync } = require("node:fs");
        const worker = new Worker(new URL("./worker.js", import.meta.url));
        const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
        // The helper is provably blocked on the worker's behalf before terminate().
        while (!existsSync(CLIP_DIR + "/helper-started")) await Bun.sleep(5);
        worker.terminate();
        writeFileSync(CLIP_DIR + "/release", "");
        await closed;
        print({ after: await settle(navigator.clipboard.writeText("after")), leftovers: leftovers() });
      `,
      {},
      { "worker.js": `navigator.clipboard.writeText("from the worker").catch(() => {});` },
    );
    expect({ result, log }).toEqual({
      result: { after: {}, leftovers: [] },
      log: ["xclip -selection clipboard -in", "xclip -selection clipboard -in"],
    });
  });
});

// The in-process backends with operations arriving from several pool threads
// at once (how they run now that nothing queues them), plus the other user of
// the same OS clipboard in this process, Bun.Image.fromClipboard(), which reads
// it synchronously on the JS thread. Regression for both platforms: without
// one-transaction-at-a-time locking, Windows died of STATUS_HEAP_CORRUPTION and
// macOS segfaulted inside AppKit within a few rounds of this. A child process
// keeps a crash from taking the runner down; every value read must be one some
// write actually produced.
describe.skipIf(!isMacOS && !isWindows)("concurrent operations", () => {
  test("reads, writes and Bun.Image.fromClipboard() racing each other all settle with whole values", async () => {
    if (savedClipboard === null) return; // no reachable clipboard in this session
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const png = new Blob([Buffer.from(${JSON.stringify(PNG_1X1.toString("base64"))}, "base64")], { type: "image/png" });
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": "initial", "text/html": "<b>initial</b>", "image/png": png })]);
          const texts = new Set();
          const shapes = new Set();
          const failures = new Set();
          const images = new Set();
          const settle = promise => promise.catch(e => failures.add(e.name + ": " + e.message));
          const imageNow = () => {
            try {
              images.add(Bun.Image.fromClipboard() === null ? "none" : "image");
            } catch (e) {
              failures.add("fromClipboard: " + e.message);
            }
          };
          imageNow();
          const initialImage = [...images];
          for (let round = 0; round < 10; round++) {
            const ops = [];
            for (let i = 0; i < 4; i++) {
              ops.push(settle(navigator.clipboard.writeText("w" + round + "-" + i)));
              ops.push(settle(navigator.clipboard.readText().then(text => texts.add(text))));
              ops.push(settle(navigator.clipboard.read().then(items => shapes.add(items.map(item => [...item.types].join("+")).join(",")))));
              imageNow();
            }
            await Promise.all(ops);
          }
          console.log(JSON.stringify({ initialImage, images: [...images].sort(), texts: [...texts], shapes: [...shapes], failures: [...failures] }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`child exited with ${exitCode}\n${stderr}`);
    const { initialImage, images, texts, shapes, failures } = JSON.parse(stdout) as Record<string, string[]>;
    const wholeText = /^(initial|w\d+-\d+)$/;
    const wholeItem = /^text\/plain(\+text\/html\+image\/png)?$/;
    expect({
      initialImage,
      // "none" once the writeText()s have replaced the initial item.
      sawNoImage: images.includes("none"),
      tornTexts: texts.filter(text => !wholeText.test(text)),
      tornItems: shapes.filter(shape => !wholeItem.test(shape)),
      sawText: texts.length > 0,
      sawItems: shapes.length > 0,
      // A macOS read() spans several pasteboard transactions and gives up if
      // the writers keep landing between them; that is its documented outcome.
      failures: failures.filter(
        f => !(isMacOS && f === "NotAllowedError: The system clipboard changed while it was being read."),
      ),
    }).toEqual({
      initialImage: ["image"],
      sawNoImage: true,
      tornTexts: [],
      tornItems: [],
      sawText: true,
      sawItems: true,
      failures: [],
    });
  });
});

// The NSPasteboard backend against the tools every macOS user has: what
// pbcopy puts on the pasteboard is what readText() returns, and pbpaste sees
// what writeText() put there, so the data is in the public plain-text type
// and not something only Bun can read.
describe.skipIf(!isMacOS)("macOS pasteboard interop", () => {
  test("pbcopy feeds readText(), and pbpaste sees writeText()", async () => {
    if (savedClipboard === null) return; // no pasteboard server in this session
    const fromPbcopy = `from pbcopy ${Date.now()}`;
    await using pbcopy = Bun.spawn({ cmd: ["pbcopy"], stdin: "pipe", stderr: "pipe" });
    pbcopy.stdin.write(fromPbcopy);
    await pbcopy.stdin.end();
    // Drained so a chatty tool cannot block; the text is in the diff, not asserted.
    expect(await Promise.all([pbcopy.stderr.text(), pbcopy.exited])).toEqual([expect.any(String), 0]);
    expect(await navigator.clipboard.readText()).toBe(fromPbcopy);
    expect((await navigator.clipboard.read()).map(item => [...item.types])).toEqual([["text/plain"]]);

    const fromBun = `from bun ${Date.now()}`;
    await navigator.clipboard.writeText(fromBun);
    await using pbpaste = Bun.spawn({ cmd: ["pbpaste"], stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      pbpaste.stdout.text(),
      pbpaste.stderr.text(),
      pbpaste.exited,
    ]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: fromBun, stderr: expect.any(String), exitCode: 0 });
  });
});

// The Win32 backend has to interoperate with every other producer and
// consumer of CF_UNICODETEXT, "HTML Format" (CF_HTML) and "PNG". These tests
// stand in for them by driving the raw clipboard through bun:ffi: placing
// payloads the way other programs lay them out, and inspecting exactly what
// Bun places. Everything here mutates the real clipboard, so nothing is
// concurrent; the file-level hooks restore what the machine had.
const CF_TEXT = 1;
const CF_UNICODETEXT = 13;
// GMEM_MOVEABLE | GMEM_ZEROINIT, so any allocation past the payload reads as NUL.
const GHND = 0x0042;
const START_MARK = "<!--StartFragment-->";
const END_MARK = "<!--EndFragment-->";

interface RawEntry {
  format: number;
  bytes: Uint8Array;
  /** Allocation size when it should exceed the payload; defaults to the exact length. */
  size?: number;
}

interface Win32Clipboard {
  /** RegisterClipboardFormatW: the id the backend gets for the same name. */
  format(name: string): number;
  /** Empties the clipboard and places each entry as its own HGLOBAL. */
  setRaw(entries: RawEntry[]): void;
  /** A copy of the HGLOBAL behind `format`, GlobalSize bytes long; null when absent. */
  getRaw(format: number): Buffer | null;
}

let win32: Win32Clipboard | null = null;
if (isWindows) {
  try {
    const user32 = dlopen("user32.dll", {
      OpenClipboard: { args: [FFIType.ptr], returns: FFIType.i32 },
      CloseClipboard: { args: [], returns: FFIType.i32 },
      EmptyClipboard: { args: [], returns: FFIType.i32 },
      SetClipboardData: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
      GetClipboardData: { args: [FFIType.u32], returns: FFIType.ptr },
      RegisterClipboardFormatW: { args: [FFIType.ptr], returns: FFIType.u32 },
    }).symbols;
    const kernel32 = dlopen("kernel32.dll", {
      GlobalAlloc: { args: [FFIType.u32, FFIType.u64], returns: FFIType.ptr },
      GlobalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
      GlobalLock: { args: [FFIType.ptr], returns: FFIType.ptr },
      GlobalUnlock: { args: [FFIType.ptr], returns: FFIType.i32 },
      GlobalSize: { args: [FFIType.ptr], returns: FFIType.u64_fast },
    }).symbols;

    // Clipboard listeners (history, rdpclip) hold the clipboard briefly after
    // every change; retry the way the backend does.
    const withClipboardOpen = <T>(fn: () => T): T => {
      for (let attempt = 0; user32.OpenClipboard(null) === 0; attempt++) {
        if (attempt === 50) throw new Error("OpenClipboard kept failing");
        Bun.sleepSync(2);
      }
      try {
        return fn();
      } finally {
        user32.CloseClipboard();
      }
    };

    const allocGlobal = ({ bytes, size = bytes.byteLength }: RawEntry) => {
      const h = kernel32.GlobalAlloc(GHND, Math.max(size, bytes.byteLength, 1));
      if (h === null) throw new Error("GlobalAlloc failed");
      const p = kernel32.GlobalLock(h);
      if (p === null) throw new Error("GlobalLock failed");
      if (bytes.byteLength > 0) toBuffer(p, 0, bytes.byteLength).set(bytes);
      kernel32.GlobalUnlock(h);
      return h;
    };

    // Proves this session can reach the clipboard at all; otherwise the block skips.
    withClipboardOpen(() => {});

    win32 = {
      format(name) {
        const id = user32.RegisterClipboardFormatW(ptr(Buffer.from(name + "\0", "utf16le")));
        if (id === 0) throw new Error(`RegisterClipboardFormatW(${name}) failed`);
        return id;
      },
      setRaw(entries) {
        const handles = entries.map(entry => [entry.format, allocGlobal(entry)] as const);
        // The system owns each handle once SetClipboardData accepts it.
        let accepted = 0;
        try {
          withClipboardOpen(() => {
            if (user32.EmptyClipboard() === 0) throw new Error("EmptyClipboard failed");
            for (const [format, h] of handles) {
              if (user32.SetClipboardData(format, h) === null) throw new Error(`SetClipboardData(${format}) failed`);
              accepted++;
            }
          });
        } finally {
          for (const [, h] of handles.slice(accepted)) kernel32.GlobalFree(h);
        }
      },
      getRaw(format) {
        return withClipboardOpen(() => {
          const h = user32.GetClipboardData(format);
          if (h === null) return null;
          const size = Number(kernel32.GlobalSize(h));
          const out = Buffer.alloc(size);
          if (size === 0) return out;
          const p = kernel32.GlobalLock(h);
          if (p === null) throw new Error("GlobalLock failed");
          try {
            out.set(toBuffer(p, 0, size));
          } finally {
            kernel32.GlobalUnlock(h);
          }
          return out;
        });
      },
    };
  } catch (e) {
    console.error("skipping the Win32 backend tests:", (e as Error)?.message ?? e);
  }
}

describe.skipIf(!isWindows || win32 === null)("Win32 backend", () => {
  const raw = () => win32!;
  const utf16z = (text: string) => Buffer.from(text + "\0", "utf16le");
  let CF_HTML = 0;
  let CF_PNG = 0;
  let CF_IMAGE_PNG = 0;
  beforeAll(() => {
    CF_HTML = raw().format("HTML Format");
    CF_PNG = raw().format("PNG");
    CF_IMAGE_PNG = raw().format("image/png");
  });

  // Every representation of every item, in a shape toEqual can diff whole.
  async function readAll(): Promise<Record<string, unknown>[]> {
    const items = await navigator.clipboard.read();
    return Promise.all(
      items.map(async item => {
        const out: Record<string, unknown> = { types: [...item.types] };
        for (const type of item.types) {
          const blob = await item.getType(type);
          out[type] = type === "image/png" ? Buffer.from(await blob.arrayBuffer()) : await blob.text();
        }
        return out;
      }),
    );
  }

  // A CF_HTML payload as another producer might lay it out: Version:1.0,
  // 6-digit fields, an optional extra header line. The offsets locate
  // `fragment` inside `body` in bytes; `overrides` replaces fields verbatim
  // for the malformed cases.
  function foreignCfHtml(body: string, fragment: string, overrides: Record<string, string> = {}, extraHeader = "") {
    const fields = ["StartHTML", "EndHTML", "StartFragment", "EndFragment"];
    const headerLength = Buffer.byteLength(
      `Version:1.0\r\n${fields.map(f => `${f}:000000\r\n`).join("")}${extraHeader}`,
    );
    const bodyBytes = Buffer.from(body);
    const fragmentAt = bodyBytes.indexOf(Buffer.from(fragment));
    if (fragmentAt < 0) throw new Error("fragment is not in body");
    const offsets: Record<string, number> = {
      StartHTML: headerLength,
      EndHTML: headerLength + bodyBytes.length,
      StartFragment: headerLength + fragmentAt,
      EndFragment: headerLength + fragmentAt + Buffer.byteLength(fragment),
    };
    const header = `Version:1.0\r\n${fields
      .map(f => `${f}:${overrides[f] ?? String(offsets[f]).padStart(6, "0")}\r\n`)
      .join("")}${extraHeader}`;
    return Buffer.concat([Buffer.from(header), bodyBytes]);
  }

  test("read() extracts a foreign CF_HTML fragment from the header byte offsets", async () => {
    // No fragment markers, so only the offsets can locate it; the non-ASCII
    // header line and fragment make byte offsets differ from char offsets.
    const fragment = "<p>naïve ☃ 日本</p>";
    const payload = foreignCfHtml(
      `<html><head><title>t</title></head><body>\r\n${fragment}\r\n</body></html>`,
      fragment,
      {},
      "SourceURL:https://example.com/ü\r\n",
    );
    raw().setRaw([{ format: CF_HTML, bytes: payload }]);
    expect(await readAll()).toEqual([{ types: ["text/html"], "text/html": fragment }]);
    expect(await navigator.clipboard.readText()).toBe("");
  });

  test("valid header offsets win over the fragment markers", async () => {
    // Producers such as Excel put context inside the markers and point the
    // offsets at the real selection; the offsets are authoritative.
    const payload = foreignCfHtml(
      `<html><body>${START_MARK}<table><tr><td>inner</td></tr></table>${END_MARK}</body></html>`,
      "<td>inner</td>",
    );
    raw().setRaw([{ format: CF_HTML, bytes: payload }]);
    expect(await readAll()).toEqual([{ types: ["text/html"], "text/html": "<td>inner</td>" }]);
  });

  test("unusable header offsets fall back to the fragment markers", async () => {
    const body = `<html><body>${START_MARK}<i>marked ü</i>${END_MARK}</body></html>`;
    const fragment = "<i>marked ü</i>";
    const malformed: Record<string, string>[] = [
      { EndFragment: "9999999999" },
      { StartFragment: "000090", EndFragment: "000050" },
      { StartFragment: "-1", EndFragment: "garbage" },
      { StartFragment: "99999999999999999999999" },
    ];
    const results: unknown[] = [];
    for (const overrides of malformed) {
      raw().setRaw([{ format: CF_HTML, bytes: foreignCfHtml(body, fragment, overrides) }]);
      results.push(await readAll());
    }
    expect(results).toEqual(malformed.map(() => [{ types: ["text/html"], "text/html": fragment }]));
  });

  test("CF_HTML with neither usable offsets nor markers reads as absent", async () => {
    const broken = [
      foreignCfHtml("<html><body><i>unreachable</i></body></html>", "<i>unreachable</i>", {
        StartFragment: "x",
        EndFragment: "y",
      }),
      // Not an envelope at all; some producers put bare markup there.
      Buffer.from("<b>bare markup</b>"),
    ];
    for (const payload of broken) {
      raw().setRaw([{ format: CF_HTML, bytes: payload }]);
      expect(await readAll()).toEqual([]);
      // The unparsable representation does not take the others down with it.
      raw().setRaw([
        { format: CF_HTML, bytes: payload },
        { format: CF_UNICODETEXT, bytes: utf16z("still here") },
      ]);
      expect(await readAll()).toEqual([{ types: ["text/plain"], "text/plain": "still here" }]);
    }
  });

  test("CF_HTML is parsed up to the first NUL of the allocation", async () => {
    const fragment = "<i>padded</i>";
    const padded = foreignCfHtml(`<html><body>${START_MARK}${fragment}${END_MARK}</body></html>`, fragment);
    raw().setRaw([{ format: CF_HTML, bytes: padded, size: padded.length + 64 }]);
    expect(await readAll()).toEqual([{ types: ["text/html"], "text/html": fragment }]);

    // Markers that only exist past the terminator are not part of the payload.
    const beforeNul = foreignCfHtml("<html><body>no markers</body></html>", "no markers", { EndFragment: "x" });
    const stale = Buffer.concat([beforeNul, Buffer.from("\0"), Buffer.from(`${START_MARK}stale${END_MARK}`)]);
    raw().setRaw([{ format: CF_HTML, bytes: stale }]);
    expect(await readAll()).toEqual([]);
  });

  test("raw CF_UNICODETEXT: embedded NUL, unpaired surrogate, missing terminator, empty string", async () => {
    const cases: [name: string, bytes: Buffer][] = [
      ["embedded NUL", utf16z("a\0b")],
      ["unpaired surrogate", Buffer.from(new Uint16Array([0xd800, 0x78, 0]).buffer)],
      // Exact-size allocation with no terminator: the read stops at GlobalSize.
      // Windows may hand back its own copy of text data with the last unit
      // overwritten by a terminator (observed on a machine with the clipboard
      // history service), so a correct read sees "h" there and "hi" elsewhere.
      ["no terminator", Buffer.from("hi", "utf16le")],
      ["only a terminator", utf16z("")],
    ];
    const results: Record<string, unknown> = {};
    for (const [name, bytes] of cases) {
      raw().setRaw([{ format: CF_UNICODETEXT, bytes }]);
      results[name] = { text: await navigator.clipboard.readText(), items: await readAll() };
    }
    const present = (text: unknown) => ({ text, items: [{ types: ["text/plain"], "text/plain": text }] });
    expect(results).toEqual({
      "embedded NUL": present("a"),
      "unpaired surrogate": present("\uFFFDx"),
      "no terminator": present(expect.stringMatching(/^hi?$/)),
      "only a terminator": present(""),
    });
  });

  test("CF_TEXT from an ANSI producer is read through the CF_UNICODETEXT Windows synthesizes", async () => {
    raw().setRaw([{ format: CF_TEXT, bytes: Buffer.from("ansi only\0", "latin1") }]);
    expect(await navigator.clipboard.readText()).toBe("ansi only");
    expect(await readAll()).toEqual([{ types: ["text/plain"], "text/plain": "ansi only" }]);
  });

  test("an emptied clipboard, or one holding only a private format, reads as '' and []", async () => {
    await navigator.clipboard.writeText("about to be emptied");
    raw().setRaw([]);
    expect([await navigator.clipboard.readText(), await readAll()]).toEqual(["", []]);

    const privateFormat = raw().format("Bun.Test.Private");
    raw().setRaw([{ format: privateFormat, bytes: Buffer.from("private payload") }]);
    expect(raw().getRaw(privateFormat)?.toString()).toBe("private payload");
    expect([await navigator.clipboard.readText(), await readAll()]).toEqual(["", []]);
  });

  test('a PNG registered as "image/png" is read; write() places it as "PNG" and reads it back exactly', async () => {
    raw().setRaw([{ format: CF_IMAGE_PNG, bytes: PNG_1X1 }]);
    expect(raw().getRaw(CF_PNG)).toBeNull();
    expect(await readAll()).toEqual([{ types: ["image/png"], "image/png": PNG_1X1 }]);

    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([PNG_1X1], { type: "image/png" }) })]);
    expect(raw().getRaw(CF_IMAGE_PNG)).toBeNull();
    // GlobalSize rounds up to the allocator's granularity; the stream itself
    // is what write() placed, and read() trims the slack off at IEND.
    const placed = raw().getRaw(CF_PNG)!;
    expect(placed.subarray(0, PNG_1X1.length)).toEqual(PNG_1X1);
    expect(placed.length - PNG_1X1.length).toBeLessThan(16);
    expect(await readAll()).toEqual([{ types: ["image/png"], "image/png": PNG_1X1 }]);
  });

  test("a PNG placed by another process reads back byte-exact", async () => {
    // Data set by another process arrives through the kernel's copy, where
    // the allocation size is not ours to control.
    raw().setRaw([]);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([Buffer.from(${JSON.stringify(PNG_1X1.toString("base64"))}, "base64")], { type: "image/png" }) })])`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    expect(await readAll()).toEqual([{ types: ["image/png"], "image/png": PNG_1X1 }]);
  });

  test("write() produces a CF_HTML envelope an independent reader can parse", async () => {
    const fragment = "<b>x &amp; y</b> ü";
    await navigator.clipboard.write([new ClipboardItem({ "text/html": fragment })]);
    const block = raw().getRaw(CF_HTML)!;
    const nul = block.indexOf(0);
    const payload = block.subarray(0, nul < 0 ? block.length : nul);
    const text = payload.toString("latin1"); // one char per byte, so the fields index it directly
    const field = (name: string) => Number(new RegExp(`^${name}:(\\d{10})\\r\\n`, "m").exec(text)?.[1]);
    const [startHtml, endHtml, startFragment, endFragment] = [
      "StartHTML",
      "EndHTML",
      "StartFragment",
      "EndFragment",
    ].map(field);
    const digits = (n: number) => String(n).padStart(10, "0");
    expect({
      nulTerminated: nul >= 0,
      header: payload.subarray(0, startHtml).toString(),
      html: payload.subarray(startHtml, endHtml).toString(),
      fragment: payload.subarray(startFragment, endFragment).toString(),
      fragmentBytes: endFragment - startFragment,
      endHtml,
    }).toEqual({
      // strlen-based consumers (.NET's DataObject) need the terminator.
      nulTerminated: true,
      header: `Version:0.9\r\nStartHTML:${digits(startHtml)}\r\nEndHTML:${digits(endHtml)}\r\nStartFragment:${digits(startFragment)}\r\nEndFragment:${digits(endFragment)}\r\n`,
      html: `<html>\r\n<body>\r\n${START_MARK}${fragment}${END_MARK}\r\n</body>\r\n</html>`,
      fragment,
      // ü is two bytes: the fields count bytes, not characters.
      fragmentBytes: Buffer.byteLength(fragment),
      endHtml: payload.length,
    });
    expect(await readAll()).toEqual([{ types: ["text/html"], "text/html": fragment }]);
  });

  test("writeText() places CRLF-normalized, NUL-terminated CF_UNICODETEXT", async () => {
    const cases: [input: string, placed: string][] = [
      ["a\nb\r\nc", "a\r\nb\r\nc\0"],
      ["\n\n", "\r\n\r\n\0"],
      ["tab\there ü\r", "tab\there ü\r\0"],
    ];
    const results: string[] = [];
    for (const [input] of cases) {
      await navigator.clipboard.writeText(input);
      // Up to and including the terminator; GlobalSize may add zeroed slack.
      const units = raw().getRaw(CF_UNICODETEXT)!.toString("utf16le");
      results.push(units.slice(0, units.indexOf("\0") + 1));
    }
    expect(results).toEqual(cases.map(([, placed]) => placed));
  });

  test("one write() places every representation; writeText() then replaces all of them", async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": "plain",
        "text/html": "<b>plain</b>",
        "image/png": new Blob([PNG_1X1], { type: "image/png" }),
      }),
    ]);
    expect(await readAll()).toEqual([
      {
        types: ["text/plain", "text/html", "image/png"],
        "text/plain": "plain",
        "text/html": "<b>plain</b>",
        "image/png": PNG_1X1,
      },
    ]);

    await navigator.clipboard.writeText("text again");
    expect(await readAll()).toEqual([{ types: ["text/plain"], "text/plain": "text again" }]);
    expect([raw().getRaw(CF_HTML), raw().getRaw(CF_PNG)]).toEqual([null, null]);
  });

  test("interoperates with clip.exe and Get-Clipboard", async () => {
    const fromClip = `from clip.exe ${Date.now()}`;
    await using clip = Bun.spawn({ cmd: ["clip.exe"], env: bunEnv, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    clip.stdin.write(fromClip);
    await clip.stdin.end();
    expect(await Promise.all([clip.stdout.text(), clip.stderr.text(), clip.exited])).toEqual([
      expect.any(String),
      expect.any(String),
      0,
    ]);
    expect(await navigator.clipboard.readText()).toBe(fromClip);

    const fromBun = `from bun ${Date.now()}`;
    await navigator.clipboard.writeText(fromBun);
    await using powershell = Bun.spawn({
      cmd: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      powershell.stdout.text(),
      powershell.stderr.text(),
      powershell.exited,
    ]);
    expect({ stdout: stdout.trimEnd(), stderr, exitCode }).toEqual({
      stdout: fromBun,
      stderr: expect.any(String),
      exitCode: 0,
    });
  });
});
