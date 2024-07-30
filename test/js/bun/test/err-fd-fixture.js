try {
  await require("fs").promises.readFile("this-file-path-is-bad");
} catch (e) {
  Object.defineProperty(e, "fd", {
    get() {
      throw new Error("wat");
    },
    enumerable: true,
  });
  throw e;
}
