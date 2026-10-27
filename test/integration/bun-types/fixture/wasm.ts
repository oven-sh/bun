async () => {
  // Fetch and compile a WebAssembly module
  const response = await fetch("module.wasm");
  const buffer = await response.arrayBuffer();
  const module = await WebAssembly.compile(buffer);

  // Create a WebAssembly Memory object
  const memory = new WebAssembly.Memory({ initial: 1 });

  // Create a WebAssembly Table object
  const table = new WebAssembly.Table({ initial: 1, element: "anyfunc" });

  // Memory64: i64-addressed memories and tables take and return bigint sizes
  const memory64 = new WebAssembly.Memory({ address: "i64", initial: 1 });
  const table64 = new WebAssembly.Table({ address: "i64", initial: 1, element: "anyfunc" });
  const memory64Descriptor: Bun.WebAssembly.MemoryDescriptor = { address: "i64", initial: 1n, maximum: 4n };
  const table64Descriptor: Bun.WebAssembly.TableDescriptor = { address: "i64", initial: 1n, element: "externref" };
  const grown64: bigint = memory64.grow(1n);
  const grown32: number = memory.grow(1);
  const tableGrown64: bigint = table64.grow(1n);
  const tableGrown32: number = table.grow(1);
  table64.get(0n);
  table64.set(0n, undefined);
  memory64Descriptor;
  table64Descriptor;
  grown64;
  grown32;
  tableGrown64;
  tableGrown32;

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

  // Use the WebAssembly Table
  table.set(0, instance.exports.exportedTableFunction);
  // eslint-disable-next-line
  table.get(0)(); // Call a function stored in the table

  // Additional operations with instance, memory, and table can be performed here
};
