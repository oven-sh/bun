import * as self from "./unset-names.mjs";
(() => {
  throw Object.assign(new Error("stops here"), { namespace: self });
})();
// pretty-format reads these names off every value before it prints the properties.
export const $$typeof = 1, toJSON = 2, constructor = 3, _isMockFunction = 4, asymmetricMatch = 5, nodeType = 6;
