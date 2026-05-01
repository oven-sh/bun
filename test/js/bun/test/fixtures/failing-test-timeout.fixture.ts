import { isCI, isWindows } from "harness";

jest.setTimeout(5);

describe("test.failing", () => {
  test.failing("Timeouts still count as failures", async () => {
    await Bun.sleep(1000);
  });

  // fixme: hangs on windows. Timer callback never fires
  describe.skipIf(isWindows && isCI)("when using a done() callback", () => {
    test.failing("fails when an async test never calls done()", async _done => {
      // nada
    });

    test.failing("fails when a sync test never calls done()", _done => {
      // nada
    });
  });
});
