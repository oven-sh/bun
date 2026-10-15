// Used by plugin-buffer-contents-fixture.ts, as a module and as a macro.
//
// `globalThis.contents` is the `contents` of the module that the transpiler is
// reading when one of these runs.

declare global {
  var contents: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | string;
  // The length of the string that a string `contents` was cut from.
  var cutFromLength: number;
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

// Uses a string `contents` as a property key, which makes its JSString take
// its own copy of the characters. Then collects, and allocates strings of the
// size of the string that `contents` was cut from, so that the characters it
// pointed into are freed and written again.
export function atomize() {
  const key: Record<string, number> = {};
  key[globalThis.contents as string] = 1;
  const garbage: string[] = [];
  for (let i = 0; i < 2; i++) {
    Bun.gc(true);
    for (let j = 0; j < 64; j++) {
      garbage.push(Buffer.alloc(globalThis.cutFromLength, String.fromCharCode(65 + (j % 26))).toString());
    }
  }
  return Object.keys(key).length + " key, " + garbage.length + " strings";
}
