// Shaped like esbuild/tsc-compiled CJS output: exports defined as getters
// next to an `__esModule` data property. The auto-mock walker must read these
// getters (the `__esModule` exception in jest-mock's `_getSlots`) or the mock
// comes out as just `{ __esModule: true }`.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "helper", {
  enumerable: true,
  get: function () {
    return helper;
  },
});
Object.defineProperty(exports, "VERSION", {
  enumerable: true,
  get: function () {
    return "1.2.3";
  },
});
Object.defineProperty(exports, "default", {
  enumerable: true,
  get: function () {
    return helper;
  },
});
function helper() {
  return "real-helper";
}
