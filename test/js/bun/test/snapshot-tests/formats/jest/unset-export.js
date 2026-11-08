import * as self from "./unset-export.js";
export function hoisted() {}
// Nothing below the throw runs, so `later` stays in its temporal dead zone.
(() => {
  throw Object.assign(new Error("stops here"), { namespace: self });
})();
export const later = 1;
