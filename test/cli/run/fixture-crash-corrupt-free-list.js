// Crashes inside the allocator. A free list of mimalloc, for blocks of one size, is made to point to an address that
// is never mapped, and a later request for that size follows it. The crash handler then runs on a thread that cannot
// be given a block of that size.
//
// usage: bun fixture-crash-corrupt-free-list.js <size of block>
const { ptr, toArrayBuffer } = require("bun:ffi");

const size = Number(process.argv[2]);
const count = 2048;
// The crash report names this address.
const nowhere = 0x414141414140n;

// The bytes of a small ArrayBuffer are one block of mimalloc.
const blocks = Array.from({ length: count }, () => new ArrayBuffer(size));
const addresses = blocks.map(block => ptr(block));
const first = addresses.reduce((a, b) => Math.min(a, b));
const last = addresses.reduce((a, b) => Math.max(a, b));
// One view over all the blocks, made before any of them is free.
const words = new BigUint64Array(toArrayBuffer(first, 0, last - first + 8));

// `transfer()` to another size frees the block at once. Every other block stays, so that no page of them becomes empty
// and goes back to mimalloc.
const freed = new Set();
const moved = [];
for (let i = 1; i < count; i += 2) {
  freed.add(BigInt(addresses[i]));
  moved.push(blocks[i].transfer(4096));
}

// The first word of a free block is the link to the next free block. A block that is in use again has another word
// there, and stays as it is.
let links = 0;
for (let i = 1; i < count; i += 2) {
  const at = (addresses[i] - first) / 8;
  if (freed.has(words[at])) {
    words[at] = nowhere;
    links++;
  }
}
if (links < 32) {
  console.error(`${links} of the ${count / 2} free blocks of ${size} bytes start with a link to another of them`);
  process.exit(1);
}

const more = [];
for (let i = 0; i < count * 4; i++) more.push(new ArrayBuffer(size));
console.error("the allocator did not crash");
process.exit(1);
