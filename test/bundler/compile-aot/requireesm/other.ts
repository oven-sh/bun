export function viaRequire(): number { const m = require("./lib.ts"); return m.bump() + new m.Thing(4).twice(); }
console.log("other evaluated");
