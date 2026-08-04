// Asserts that specific dead symbols removed from webcore C++ bindings and
// assorted Rust crates do not reappear. Each entry is a symbol that was
// verified to have zero callers (rg across src/ and generated code) before
// deletion; the build and affected-area tests pass with it gone.

import { describe, expect, test } from "bun:test";
import { file } from "bun";
import { existsSync } from "fs";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const src = (p: string) => path.join(root, "src", p);

async function read(p: string): Promise<string> {
  return await file(src(p)).text();
}

describe("dead webcore C++ symbols stay removed", () => {
  test("JSDOMBuiltinConstructor.h (whole-file template, never #included)", () => {
    expect(existsSync(src("jsc/bindings/webcore/JSDOMBuiltinConstructor.h"))).toBe(false);
  });

  test("EventNames: touch/gesture stubs", async () => {
    const h = await read("jsc/bindings/webcore/EventNames.h");
    expect(h).not.toContain("isGestureEventType");
    expect(h).not.toContain("isTouchRelatedEventType");
    expect(h).not.toContain("isTouchScrollBlockingEventType");
    expect(h).not.toContain("touchRelatedEventNames");
    expect(h).not.toContain("extendedTouchRelatedEventNames");
    expect(h).not.toContain("gestureEventNames");
  });

  test("Event: underlyingEvent / createForBindings / debugDescription / operator<<", async () => {
    const h = await read("jsc/bindings/webcore/Event.h");
    const cpp = await read("jsc/bindings/webcore/Event.cpp");
    expect(h).not.toContain("m_underlyingEvent");
    expect(h).not.toContain("setUnderlyingEvent");
    expect(h).not.toContain("createForBindings");
    expect(h).not.toMatch(/MonotonicTime timeStamp\(\) const/);
    expect(h).not.toContain("debugDescription");
    expect(cpp).not.toContain("setUnderlyingEvent");
    expect(cpp).not.toContain("createForBindings");
    expect(cpp).not.toContain("debugDescription");
    expect(cpp).not.toMatch(/TextStream& operator<</);
  });

  test("MessageEvent: createForBindings", async () => {
    const h = await read("jsc/bindings/webcore/MessageEvent.h");
    const cpp = await read("jsc/bindings/webcore/MessageEvent.cpp");
    expect(h).not.toContain("createForBindings");
    expect(cpp).not.toContain("createForBindings");
  });

  test("AbortSignal: signalFollow / setAborted", async () => {
    const h = await read("jsc/bindings/webcore/AbortSignal.h");
    const cpp = await read("jsc/bindings/webcore/AbortSignal.cpp");
    expect(h).not.toContain("signalFollow");
    expect(h).not.toMatch(/void setAborted\(bool/);
    expect(cpp).not.toContain("signalFollow");
    expect(cpp).not.toContain("AbortSignal__Timeout__run");
  });

  test("EventListenerMap / IdentifierEventListenerMap: replace()", async () => {
    expect(await read("jsc/bindings/webcore/EventListenerMap.h")).not.toMatch(/void replace\(/);
    expect(await read("jsc/bindings/webcore/EventListenerMap.cpp")).not.toContain("EventListenerMap::replace");
    expect(await read("jsc/bindings/webcore/IdentifierEventListenerMap.h")).not.toMatch(/void replace\(/);
    expect(await read("jsc/bindings/webcore/IdentifierEventListenerMap.cpp")).not.toContain(
      "IdentifierEventListenerMap::replace",
    );
  });

  test("EventEmitter: isNode / uncaughtExceptionInEventHandler / invalidateEventListenerRegions / invalidateJSEventListeners", async () => {
    const h = await read("jsc/bindings/webcore/EventEmitter.h");
    const cpp = await read("jsc/bindings/webcore/EventEmitter.cpp");
    expect(h).not.toMatch(/bool isNode\(\) const/);
    expect(h).not.toContain("uncaughtExceptionInEventHandler");
    expect(h).not.toContain("invalidateEventListenerRegions");
    expect(h).not.toContain("invalidateJSEventListeners");
    expect(cpp).not.toContain("uncaughtExceptionInEventHandler");
    expect(cpp).not.toContain("invalidateEventListenerRegions");
  });

  test("HTTPHeaderMap: append / clear / shrinkToFit", async () => {
    const h = await read("jsc/bindings/webcore/HTTPHeaderMap.h");
    const cpp = await read("jsc/bindings/webcore/HTTPHeaderMap.cpp");
    expect(h).not.toMatch(/void append\(const String& name, const String& value\)/);
    expect(h).not.toMatch(/void clear\(\)/);
    expect(h).not.toMatch(/void shrinkToFit\(\)/);
    expect(cpp).not.toContain("HTTPHeaderMap::append");
  });

  test("DOMPromise: instance whenSettled / result / status", async () => {
    const h = await read("jsc/bindings/webcore/JSDOMPromise.h");
    const cpp = await read("jsc/bindings/webcore/JSDOMPromise.cpp");
    expect(h).not.toMatch(/IsCallbackRegistered whenSettled\(/);
    expect(h).not.toMatch(/JSValue result\(\) const/);
    expect(h).not.toMatch(/enum class Status/);
    expect(cpp).not.toContain("DOMPromise::whenSettled");
    expect(cpp).not.toContain("DOMPromise::result");
    expect(cpp).not.toContain("DOMPromise::status");
  });

  test("ZigGeneratedCode: commented DOMJIT fastpath blocks", async () => {
    const cpp = await read("jsc/bindings/ZigGeneratedCode.cpp");
    expect(cpp).not.toContain("DOMJIT::Signature");
    expect(cpp).not.toContain("JSC_DEFINE_JIT_OPERATION");
    expect(cpp).not.toContain("fastpathWrapper");
    expect(cpp).not.toContain("DOMJITAbstractHeap");
  });

  test("JSEventListener / JSPerformance: stale commented-out DOM-window blocks", async () => {
    expect(await read("jsc/bindings/webcore/JSEventListener.h")).not.toContain("windowEventHandlerAttribute");
    expect(await read("jsc/bindings/webcore/JSEventListener.cpp")).not.toContain("jsFunctionWindow");
    expect(await read("jsc/bindings/webcore/JSPerformance.cpp")).not.toContain("jsPerformance_navigationGetter");
  });
});

describe("dead Rust symbols stay removed", () => {
  test("bun_alloc: NullableAllocator (whole module)", async () => {
    expect(existsSync(src("bun_alloc/NullableAllocator.rs"))).toBe(false);
    const lib = await read("bun_alloc/lib.rs");
    expect(lib).not.toContain("nullable_allocator");
    expect(lib).not.toContain("NullableAllocator");
  });

  test("bun_alloc: MaxHeapAllocator::free / ArenaString::with_capacity_in", async () => {
    expect(await read("bun_alloc/MaxHeapAllocator.rs")).not.toMatch(/pub fn free\(/);
    expect(await read("bun_alloc/MimallocArena.rs")).not.toMatch(/pub fn with_capacity_in\(/);
  });

  test("bun_http: SocketTimeout::timeout / set_timeout_minutes", async () => {
    const lib = await read("http/lib.rs");
    expect(lib).not.toMatch(/fn timeout\(&self, seconds: core::ffi::c_uint\);/);
    expect(lib).not.toMatch(/fn set_timeout_minutes\(&self,/);
  });

  test("bun_libarchive: ReadArchive/WriteArchive/OwnedEntry as_ptr()", async () => {
    const lib = await read("libarchive/lib.rs");
    expect(lib).not.toMatch(/pub fn as_ptr\(&self\) -> \*mut Archive/);
    expect(lib).not.toMatch(/pub fn as_ptr\(&self\) -> \*mut Entry/);
  });

  test("bun_ini: config_iterator::Iter / ::Opt aliases", async () => {
    const lib = await read("ini/lib.rs");
    expect(lib).not.toContain("ConfigIterator as Iter");
    expect(lib).not.toContain("ConfigOpt as Opt");
  });
});
