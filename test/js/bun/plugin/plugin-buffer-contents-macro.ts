// Used by plugin-buffer-contents-fixture.ts, as a module and as a macro.
//
// `globalThis.contents` is the `contents` of the module that the transpiler is
// reading when one of these runs.

declare global {
  var contents: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | string;
  var result: { contents: unknown } | undefined;
}

function storage() {
  const contents = globalThis.contents as ArrayBufferView | ArrayBuffer;
  return (ArrayBuffer.isView(contents) ? contents.buffer : contents) as ArrayBuffer;
}

// The bytes of `contents`, to read or write them where they are. A small typed
// array holds its bytes in its GC cell until its `buffer` is read, so a
// Uint8Array is used as it is.
export function bytesOf(contents: ArrayBufferView | ArrayBuffer | SharedArrayBuffer) {
  if (contents instanceof Uint8Array) return contents;
  if (ArrayBuffer.isView(contents)) return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
  return new Uint8Array(contents);
}

// Changes the bytes behind `contents`, or takes them away. Returns `how`.
export function mutate(how: string) {
  if (how === "overwrite") {
    bytesOf(globalThis.contents as ArrayBuffer).fill(0x20);
  } else if (how === "transfer") {
    // The storage goes to another ArrayBuffer, and JS writes it there.
    const buffer = storage();
    if (!buffer.detached) new Uint8Array(buffer.transfer()).fill(0x20);
  } else if (how === "resize") {
    // The pages of a resizable ArrayBuffer go away.
    storage().resize(0);
  }
  return how;
}

// True when `contents` shows what mutate(how) did.
export function mutated(how: string) {
  if (how === "overwrite") return bytesOf(globalThis.contents as ArrayBuffer).every(byte => byte === 0x20);
  return storage().byteLength === 0;
}

// Drops every reference that JS has to a string `contents`, then collects and
// allocates, so that freed memory is used again.
export function collect() {
  globalThis.result!.contents = undefined;
  globalThis.result = undefined;
  globalThis.contents = "";
  const garbage: string[] = [];
  for (let i = 0; i < 8; i++) {
    Bun.gc(true);
    for (let j = 0; j < 64; j++) garbage.push(Buffer.alloc(4096, String(j)).toString());
  }
  return "collected " + garbage.length;
}
