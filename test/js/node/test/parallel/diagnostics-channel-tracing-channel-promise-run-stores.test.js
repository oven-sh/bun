//#FILE: test-diagnostics-channel-tracing-channel-promise-run-stores.js
//#SHA1: 4e5abb65d92cb3e649073803971180493c1a30ca
//-----------------
"use strict";

const { setTimeout } = require("node:timers/promises");
const { AsyncLocalStorage } = require("async_hooks");
const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");
const store = new AsyncLocalStorage();

const firstContext = { foo: "bar" };
const secondContext = { baz: "buz" };

test("tracingChannel promise run stores", async () => {
  const startBindStoreMock = jest.fn(() => firstContext);
  const asyncStartBindStoreMock = jest.fn(() => secondContext);

  channel.start.bindStore(store, startBindStoreMock);
  channel.asyncStart.bindStore(store, asyncStartBindStoreMock);

  expect(store.getStore()).toBeUndefined();

  await channel.tracePromise(async () => {
    expect(store.getStore()).toEqual(firstContext);
    await setTimeout(1);
    // Should _not_ switch to second context as promises don't have an "after"
    // point at which to do a runStores.
    expect(store.getStore()).toEqual(firstContext);
  });

  expect(store.getStore()).toBeUndefined();

  expect(startBindStoreMock).toHaveBeenCalledTimes(1);
  expect(asyncStartBindStoreMock).not.toHaveBeenCalled();
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-promise-run-stores.js
