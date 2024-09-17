import { afterAll, test } from "bun:test";
import {
  server,
  testReqSignalAbortEvent,
  testReqSignalAbortEventNeverResolves,
  testReqSignalGetter,
} from "./abortsignal-leak-fixture";

afterAll(async () => {
  server.stop(true);
});

test("req.signal getter should not cause AbortSignal to never be GCed", async () => {
  await testReqSignalGetter();
});

// https://github.com/oven-sh/bun/issues/4517
test("'abort' event on req.signal should not cause AbortSignal to never be GCed", async () => {
  await testReqSignalAbortEvent();
});

test("'abort' event hadnler on req.signal that never is called should not prevent AbortSignal from being GCed", async () => {
  await testReqSignalAbortEventNeverResolves();
});
