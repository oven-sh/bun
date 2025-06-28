exports[0] = 0;
Object.defineProperty(exports, "1", {
  value: 1,
  enumerable: true,
});
Object.defineProperty(exports, "2", {
  get: () => {
    return 3;
  },
  enumerable: true,
});

exports[3] = 4;
Object.defineProperty(exports, "4", {
  get() {
    throw new Error("4");
  },
  enumerable: true,
});
