console.log(
  Promise.resolve() instanceof Promise,
  ArrayBuffer.isView(new Uint8Array(1)),
  Array.isArray([]),
  Object.prototype.toString.call(/x/),
);
