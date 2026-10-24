globalThis.n = (globalThis.n || 0) + 1;
exports.partial = globalThis.n;
if (globalThis.n < 2) throw new Error("no");
