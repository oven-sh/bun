import { describe, test, jest } from "bun:test";

test("aborted readable stream calls cancel", async () => {
  const pull = jest.fn((ctrl: ReadableStreamDirectController) => {
    console.log("fetch");
    ctrl.write("hello");
    ctrl.flush();
    ctrl.write("hello");
    ctrl.flush();
    ctrl.write("hello");
    ctrl.flush();
  });
  const cancel = jest.fn();

  // server.stop();
});
