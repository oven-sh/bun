// Prints what node:util/types exports as isArrayBufferView in a realm where a script replaced
// ArrayBuffer.isView before or after the first load of the module. Each row has its own
// ShadowRealm: a new realm, with its own ArrayBuffer.isView and its own copy of the module.
const replaceWithJSFunction = `ArrayBuffer.isView = function isView() { replacementCalls++; return true; };`;

const rows = {
  "untouched": {},
  "a JS function, before the first load": { before: replaceWithJSFunction },
  "deleted, before the first load": { before: `delete ArrayBuffer.isView;` },
  "an accessor, before the first load": {
    before: `Object.defineProperty(ArrayBuffer, "isView", { get() { replacementCalls++; return () => true; } });`,
  },
  "Array.isArray, before the first load": { before: `ArrayBuffer.isView = Array.isArray;` },
  "the ArrayBuffer.isView of another realm, before the first load": {
    before: `ArrayBuffer.isView = load("node:vm").runInNewContext("ArrayBuffer.isView");`,
  },
  "a replaced globalThis.ArrayBuffer, before the first load": {
    before: `globalThis.ArrayBuffer = class { static isView() { replacementCalls++; return true; } };`,
  },
  "a JS function, after the first load": { after: replaceWithJSFunction },
};

// bun:ffi needs TinyCC, which these two targets do not have.
if (process.platform !== "freebsd" && process.platform !== "android") {
  rows["a bun:ffi function named isView, before the first load"] = {
    before: `
      const { JSCallback, linkSymbols } = load("bun:ffi");
      const callback = new JSCallback(() => { replacementCalls++; return true; }, { args: [], returns: "bool" });
      ArrayBuffer.isView = linkSymbols({ isView: { ptr: callback.ptr, args: [], returns: "bool" } }).symbols.isView;
    `,
  };
}

function exportedIn({ before = "", after = "" }) {
  return JSON.parse(
    new ShadowRealm().evaluate(`(() => {
      const original = ArrayBuffer.isView;
      const RealArrayBuffer = ArrayBuffer;
      const load = id => process.getBuiltinModule(id);
      let replacementCalls = 0;
      ${before}
      const { isArrayBufferView } = load("node:util/types");
      ${after}
      const values = {
        Uint8Array: new Uint8Array(1),
        Buffer: Buffer.alloc(1),
        DataView: new DataView(new RealArrayBuffer(1)),
        ArrayBuffer: new RealArrayBuffer(1),
        object: {},
        string: "view",
      };
      // Read without a call of the getter that a row can put there.
      const slot = Object.getOwnPropertyDescriptor(RealArrayBuffer, "isView");
      return JSON.stringify({
        name: isArrayBufferView.name,
        views: Object.keys(values).filter(name => isArrayBufferView(values[name])),
        replacementCalls,
        isReplacement: !!slot && "value" in slot && slot.value !== original && isArrayBufferView === slot.value,
        isOriginal: isArrayBufferView === original,
      });
    })()`),
  );
}

const result = {};
for (const [row, code] of Object.entries(rows)) result[row] = exportedIn(code);
console.log(JSON.stringify(result));
