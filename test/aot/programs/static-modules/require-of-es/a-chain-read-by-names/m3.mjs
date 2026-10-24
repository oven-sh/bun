const a = require("./m2.mjs");
export const c = a.c + 1;
export function f(x) {
  return x & 1 ? a.f(x) + c : c;
}
