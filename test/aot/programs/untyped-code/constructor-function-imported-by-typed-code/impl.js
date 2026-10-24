function F(b, c) { this.b = b; this.c = c; }
function viaUntyped(a) { return a.b === 123; }
globalThis.g = viaUntyped;
let n = 0; const as = [];
for (let i = 0; i < 300; i++) as.push(new F(i, "x"));
for (let i = 0; i < 300; i++) if (viaUntyped(as[i])) n++;
console.log(n);
