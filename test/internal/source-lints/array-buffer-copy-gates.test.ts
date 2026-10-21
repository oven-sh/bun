import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Native code that reads a byte of a buffer twice and counts on what it was copies the buffer first when something
// else can write it during the call. That is a SharedArrayBuffer, which another thread writes, and a `Bun.mmap` view,
// which another process writes and which is an ordinary ArrayBuffer to JavaScript. The question for both is
// `canBeWrittenConcurrently()`. `isShared()` is false for a mapping, so a copy that asks it reads a mapped file in
// place.
//
// `isShared()` is still right for what depends on the buffer being a SharedArrayBuffer to JavaScript: an argument
// that a Web API refuses, what `util.types` and N-API report, a buffer that is never pinned or detached, the
// structure of a wrapper. Those uses are counted here. A new one fails this test: decide which of the two it is, and
// then either ask `canBeWrittenConcurrently()` or add it to the count of its file.
test("a copy made because another writer can change the bytes asks canBeWrittenConcurrently()", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const isSharedByDesign: Record<string, number> = {
    // `b.bufferSource` refuses a shared buffer.
    "src/jsc/bindings/Bindgen/IDLConvert.h": 2,
    // `mapped: "borrowed"`: a body whose writes are bounded copies a shared buffer and leaves a mapping.
    "src/jsc/bindings/Bindgen/JSBytesView.cpp": 1,
    // The `shared` field of `ArrayBuffer` in Rust, pins, and `isDeepStrictEqual`.
    "src/jsc/bindings/bindings.cpp": 14,
    "src/jsc/bindings/napi.cpp": 3,
    // A shared buffer is not pinned.
    "src/jsc/bindings/node/http/JSHTTPParserPrototype.cpp": 1,
    // Refused arguments.
    "src/jsc/bindings/webcore/JSWebSocket.cpp": 3,
    "src/jsc/bindings/webcore/streams/JSCompressionStreamShared.cpp": 2,
    "src/jsc/bindings/webcore/streams/JSReadableByteStreamController.cpp": 1,
    // Structured clone passes a shared buffer by reference.
    "src/jsc/bindings/webcore/SerializedScriptValue.cpp": 4,
    // The structure of the wrapper.
    "src/jsc/modules/BunJSCModule.h": 1,
    // `util.types.isArrayBuffer` and `isSharedArrayBuffer`.
    "src/jsc/modules/NodeUtilTypesModule.cpp": 2,
  };

  const found: Record<string, number> = {};
  let scanned = 0;
  for await (const rel of new Glob("**/*.{cpp,h}").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    scanned++;
    const count = readFileSync(path.join(repoRoot, file), "utf8").split("isShared()").length - 1;
    if (count > 0) found[file] = count;
  }
  // Guard against repoRoot resolving wrong, which would make the counts pass vacuously.
  expect(scanned).toBeGreaterThan(1000);
  expect(found).toEqual(isSharedByDesign);
});
