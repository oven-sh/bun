//#FILE: test-diagnostics-channel-tracing-channel-sync-run-stores.js
//#SHA1: 51ffe2c7cb7160b565bfe6bbca0d29005a6bf876
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");
const store = new AsyncLocalStorage();

const context = { foo: "bar" };

test("diagnostics channel tracing channel sync run stores", () => {
  const startCallback = jest.fn(() => context);
  channel.start.bindStore(store, startCallback);

  expect(store.getStore()).toBeUndefined();

  const traceCallback = jest.fn(() => {
    expect(store.getStore()).toEqual(context);
  });

  channel.traceSync(traceCallback);

  expect(store.getStore()).toBeUndefined();

  expect(startCallback).toHaveBeenCalledTimes(1);
  expect(traceCallback).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-sync-run-stores.js
