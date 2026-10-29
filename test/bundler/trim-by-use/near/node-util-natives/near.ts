console.log(
  { a: [1, 2, { b: "multi\nline" }] },
  Object.assign([1, 2], { extra: true }),
  new Error("plain").message,
  Error.isError?.(new Error("e")),
);
