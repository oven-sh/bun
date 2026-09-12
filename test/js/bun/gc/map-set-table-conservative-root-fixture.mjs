// Fixture for map-set-table-conservative-root.test.ts.
//
// Fills and empties a Map or a Set while a native frame holds one word for every 64 KB boundary
// near the heap, then prints one JSON line with how much the heap grew.
//
// "block-end" holds the boundaries themselves. A MarkedBlock is 16 KB or 64 KB and aligned to its
// size, so each word is the end of the block before it, and the end of that block's last cell. The
// collector must not take it for a reference to that cell: when that cell is a table the
// collection has replaced, it keeps every later table.
//
// "interior" holds an address 1 KB before each boundary. That is inside a cell, and a pointer into
// a cell does keep it. This is the control: it shows that the words cover the blocks the tables go
// to, that the collector reads them, and that a kept table shows up in the number printed.

import { dlopen, FFIType, JSCallback } from "bun:ffi";
import { describe, heapStats } from "bun:jsc";

const [libPath, operation, words] = process.argv.slice(2);

const {
  symbols: { hold_addresses },
} = dlopen(libPath, {
  hold_addresses: { args: [FFIType.u64, FFIType.u64, FFIType.u32, FFIType.function], returns: FFIType.u32 },
});

const collection = operation === "Set add + delete" ? new Set() : new Map();
const cycle = {
  "Map set + delete": key => {
    collection.set(key, key);
    collection.delete(key);
  },
  "Set add + delete": key => {
    collection.add(key);
    collection.delete(key);
  },
  "Map set + clear": key => {
    collection.set(key, key);
    collection.clear();
  },
}[operation];
if (!cycle) throw new Error(`unknown operation: ${operation}`);

const offset = { "block-end": 0, "interior": -1024 }[words];
if (offset === undefined) throw new Error(`unknown words: ${words}`);

let key = 0;
function churn(cycles) {
  for (let i = 0; i < cycles; i++) cycle(key++);
}

// Every MarkedBlock comes from the same allocator, so the blocks that receive the tables are near
// the block of any cell. The words cover 1 GB on each side of this one.
const anchor = parseInt(describe(collection).match(/0x[0-9a-f]+/i)[0], 16);
const step = 64 * 1024;
const count = 32768;
const start = Math.floor(anchor / step) * step - (count / 2) * step + offset;

churn(4_000);
Bun.gc(true);
const before = heapStats().heapSize;

const cycles = 40_000;
let whileHeld = 0;
const callback = new JSCallback(
  () => {
    churn(cycles);
    Bun.gc(true);
    whileHeld = heapStats().heapSize;
  },
  { args: [], returns: FFIType.void },
);
const held = hold_addresses(BigInt(start), BigInt(step), count, callback.ptr);
callback.close();

console.log(JSON.stringify({ held, size: collection.size, cycles, growthWhileHeld: whileHeld - before }));
