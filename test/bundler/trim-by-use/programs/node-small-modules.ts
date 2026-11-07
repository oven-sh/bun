import types from "node:util/types";
import constants from "node:constants";
console.log(
  types.isPromise(Promise.resolve()),
  types.isRegExp(/x/),
  types.isUint8Array(new Uint8Array(1)),
  types.isProxy(new Proxy({}, {})),
  types.isBoxedPrimitive(Object(1)),
  typeof constants.O_RDONLY,
  typeof constants.SIGINT,
  typeof constants.E2BIG,
);
