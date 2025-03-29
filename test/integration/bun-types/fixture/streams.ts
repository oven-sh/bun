new ReadableStream({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});

// This will have type errors when lib.dom.d.ts is present
// Not fixable because ReadableStream has no ReadableStreamConstructor interface
// we can merge into. See https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1941
// for details about when/why/how TypeScript might support this.
new ReadableStream({
  type: "direct",
  async pull(controller) {
    controller.write(new TextEncoder().encode("Hello, world!"));
  },
});

// new ReadableStream({
//   type: "direct",
//   pull(controller) {
//     // eslint-disable-next-line
//     controller.write("hello");
//     // eslint-disable-next-line
//     controller.write("world");
//     controller.close();
//   },
//   cancel() {
//     // called if stream.cancel() is called
//   },
// });
