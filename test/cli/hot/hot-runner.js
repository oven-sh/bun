import "./hot-file-loader.css";
import "./hot-file-loader.file";
import "./hot-runner-imported";

globalThis.counter ??= 0;

// Because console.log on windows is asynchronous, it can happen that we reload on
// an incomplete write. This fails our tests even though the behavior is correct.
// To fix this we use console.write, which (apparently) performs the write in a single chunk.
console.write(`[${Date.now()}] [#!root] Reloaded: ${++globalThis.counter}\n`);
!setTimeout(() => {}, 9999999);
