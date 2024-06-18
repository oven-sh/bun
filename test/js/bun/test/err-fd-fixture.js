try {
  await require("fs").promises.readFile("][p123][1p23]p1`]3p1]23p=-~!");
} catch (e) {
  Object.defineProperty(e, "fd", {
    get() {
      throw new Error("wat");
    },
    enumerable: true,
  });
  throw e;
}
