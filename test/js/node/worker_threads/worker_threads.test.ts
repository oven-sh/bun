import wt from "worker_threads";
import {
  getEnvironmentData,
  isMainThread,
  markAsUntransferable,
  moveMessagePortToContext,
  parentPort,
  receiveMessageOnPort,
  resourceLimits,
  setEnvironmentData,
  SHARE_ENV,
  threadId,
  workerData,
  BroadcastChannel,
  MessageChannel,
  MessagePort,
  Worker,
} from "worker_threads";
test("all properties are present", () => {
  expect(wt).toHaveProperty("getEnvironmentData");
  expect(wt).toHaveProperty("isMainThread");
  expect(wt).toHaveProperty("markAsUntransferable");
  expect(wt).toHaveProperty("moveMessagePortToContext");
  expect(wt).toHaveProperty("parentPort");
  expect(wt).toHaveProperty("receiveMessageOnPort");
  expect(wt).toHaveProperty("resourceLimits");
  expect(wt).toHaveProperty("SHARE_ENV");
  expect(wt).toHaveProperty("setEnvironmentData");
  expect(wt).toHaveProperty("threadId");
  expect(wt).toHaveProperty("workerData");
  expect(wt).toHaveProperty("BroadcastChannel");
  expect(wt).toHaveProperty("MessageChannel");
  expect(wt).toHaveProperty("MessagePort");
  expect(wt).toHaveProperty("Worker");

  expect(getEnvironmentData).toBeDefined();
  expect(isMainThread).toBeDefined();
  expect(markAsUntransferable).toBeDefined();
  expect(moveMessagePortToContext).toBeDefined();
  expect(parentPort).toBeDefined();
  expect(receiveMessageOnPort).toBeDefined();
  expect(resourceLimits).toBeDefined();
  expect(SHARE_ENV).toBeDefined();
  expect(setEnvironmentData).toBeDefined();
  expect(threadId).toBeDefined();
  expect(workerData).toBeUndefined();
  expect(BroadcastChannel).toBeDefined();
  expect(MessageChannel).toBeDefined();
  expect(MessagePort).toBeDefined();
  expect(Worker).toBeDefined();

  expect(() => {
    wt.markAsUntransferable();
  }).toThrow("not implemented");

  expect(() => {
    wt.moveMessagePortToContext();
  }).toThrow("not implemented");
});
