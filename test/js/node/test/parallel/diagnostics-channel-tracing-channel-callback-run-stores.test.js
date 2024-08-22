//#FILE: test-diagnostics-channel-tracing-channel-callback-run-stores.js
//#SHA1: 8ed3a87eb9d6c1a3a624245ce5f430b7e3730d2d
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");
const store = new AsyncLocalStorage();

const firstContext = { foo: "bar" };
const secondContext = { baz: "buz" };

test("tracing channel callback run stores", async () => {
  const startBindStoreMock = jest.fn(() => firstContext);
  const asyncStartBindStoreMock = jest.fn(() => secondContext);

  channel.start.bindStore(store, startBindStoreMock);
  channel.asyncStart.bindStore(store, asyncStartBindStoreMock);

  expect(store.getStore()).toBeUndefined();

  await new Promise(resolve => {
    channel.traceCallback(
      cb => {
        expect(store.getStore()).toEqual(firstContext);
        setImmediate(cb);
      },
      0,
      {},
      null,
      () => {
        expect(store.getStore()).toEqual(secondContext);
        resolve();
      },
    );
  });

  expect(store.getStore()).toBeUndefined();
  expect(startBindStoreMock).toHaveBeenCalledTimes(1);
  expect(asyncStartBindStoreMock).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-callback-run-stores.js
