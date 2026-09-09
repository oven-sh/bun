import { afterAll, describe, test } from "bun:test";
import { createAbortSignalLeakSuite } from "./abortsignal-leak-fixture";

for (const http2 of [false, true]) {
  describe(http2 ? "http2" : "http/1.1", () => {
    const suite = createAbortSignalLeakSuite({ http2 });

    afterAll(() => {
      suite.server.stop(true);
    });

    test("req.signal getter should not cause AbortSignal to never be GCed", async () => {
      await suite.testReqSignalGetter();
    });

    // https://github.com/oven-sh/bun/issues/4517
    test("'abort' event on req.signal should not cause AbortSignal to never be GCed", async () => {
      await suite.testReqSignalAbortEvent();
    });

    test("'abort' event hadnler on req.signal that never is called should not prevent AbortSignal from being GCed", async () => {
      await suite.testReqSignalAbortEventNeverResolves();
    });
  });
}
