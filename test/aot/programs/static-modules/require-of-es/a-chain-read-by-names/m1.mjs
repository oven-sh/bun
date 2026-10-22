const a = require("./m0.mjs");
export const c = a.c + 1;
export function f(x) {
  return x & 1 ? a.f(x) + c : c;
}
