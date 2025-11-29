// Test Atomics global type definitions with TypeScript
declare const buffer: SharedArrayBuffer;
declare const view: Int32Array;
declare const view16: Int16Array;  
declare const view8: Int8Array;
declare const viewU32: Uint32Array;
declare const bigView: BigInt64Array;

// Test basic Atomics operations - type signatures only
const stored: number = Atomics.store(view, 0, 42);
const loaded: number = Atomics.load(view, 0);
const added: number = Atomics.add(view, 0, 8);
const subtracted: number = Atomics.sub(view, 0, 5);

// Test compare and exchange operations
const exchanged: number = Atomics.compareExchange(view, 0, 50, 100);
const swapped: number = Atomics.exchange(view, 0, 200);

// Test bitwise operations
const anded: number = Atomics.and(view, 0, 0xFF);
const ored: number = Atomics.or(view, 0, 0x10);
const xored: number = Atomics.xor(view, 0, 0x0F);

// Test utility functions
const lockFree4: boolean = Atomics.isLockFree(4);
const lockFree8: boolean = Atomics.isLockFree(8);

// Test synchronization primitives
const waitResult: "ok" | "not-equal" | "timed-out" = Atomics.wait(view, 0, 0, 1000);
const notified: number = Atomics.notify(view, 0, 1);

// Test with different integer TypedArray types
const stored16: number = Atomics.store(view16, 0, 42);
const loaded8: number = Atomics.load(view8, 0);
const addedU32: number = Atomics.add(viewU32, 0, 1);

// Test BigInt64Array support
const storedBig: bigint = Atomics.store(bigView, 0, 42n);
const loadedBig: bigint = Atomics.load(bigView, 0);
const addedBig: bigint = Atomics.add(bigView, 0, 8n);