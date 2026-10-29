console.log(typeof Bun.version, typeof Bun.main, import.meta.path.length > 0, typeof require, typeof module);
const loaded = await import("node:path");
console.log(loaded.basename("/a/b.txt"));
