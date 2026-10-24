// The top-level names of a CommonJS file are its own.
require("./a.cjs");
console.log(typeof leaked, typeof alsoLeaked, typeof globalThis.leaked);
