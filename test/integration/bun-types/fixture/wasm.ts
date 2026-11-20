import { expectType } from "./utilities";

async () => {
  // Fetch and compile a WebAssembly module
  const response = await fetch("module.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);

  // Create a WebAssembly Memory object
  const memory = new WebAssembly.Memory({ initial: 1 });

  // Create a WebAssembly Table object
  const table = new WebAssembly.Table({ initial: 1, element: "anyfunc" });

  // Instantiate the WebAssembly module
  const instance = await WebAssembly.instantiate(module, {
    js: {
      log: (arg: any) => console.log("Logging from WASM:", arg),
      tableFunc: () => console.log("Table function called"),
    },
    env: {
      memory: memory,
      table: table,
    },
  });

  // Exported WebAssembly functions
  const { exportedFunction } = instance.exports;
  exportedFunction;

  // Call an exported WebAssembly function
  //   exportedFunction();

  // Interact with WebAssembly memory
  const uint8Array = new Uint8Array(memory.buffer);
  uint8Array[0] = 1; // Modify memory

  // A resizable buffer of the memory, and back to a fixed-length one. Each call returns what `buffer` then holds.
  const growableMemory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const resizable = growableMemory.toResizableBuffer();
  expectType(resizable).is<ArrayBuffer>();
  resizable.resize(131072);
  expectType(growableMemory.toFixedLengthBuffer()).is<typeof growableMemory.buffer>();
  new Uint8Array(growableMemory.toFixedLengthBuffer()) satisfies Uint8Array<ArrayBuffer>;
  // `Bun.WebAssembly.Memory` is Bun's own declaration. lib.dom does not override it.
  const ofBun: Bun.WebAssembly.Memory = growableMemory;
  expectType(ofBun.toResizableBuffer()).is<ArrayBuffer>();
  expectType(ofBun.toFixedLengthBuffer()).is<ArrayBuffer>();
  // @ts-expect-error - a module cannot import an object that only has `buffer` and `grow` (LinkError at run time)
  WebAssembly.instantiate(module, { env: { memory: { buffer: new ArrayBuffer(65536), grow: (d: number) => d } } });

  // Use the WebAssembly Table
  table.set(0, instance.exports.exportedTableFunction);
  // eslint-disable-next-line
  table.get(0)(); // Call a function stored in the table

  // Additional operations with instance, memory, and table can be performed here
};
