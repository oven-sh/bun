// Loaded in front of a listener-throw-*-fixture.js (`-r` under node): the program has a reportError of its
// own on globalThis before node:net first loads. With REPORT_ERROR=getter the read itself throws. Node's
// modules never read that global, so every fixture prints what it prints without this file.
if (process.env.REPORT_ERROR === "getter") {
  Object.defineProperty(globalThis, "reportError", {
    get() {
      throw new Error("reportError was read from globalThis");
    },
    configurable: true,
  });
} else {
  globalThis.reportError = error => console.log("reportError of the program: " + error?.message);
}
