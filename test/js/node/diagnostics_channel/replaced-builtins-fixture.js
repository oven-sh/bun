// Run by diagnostics_channel.test.ts. The first argument says what to replace and when. It prints one line of JSON.
const mode = process.argv[2];

// One pass over the module: the registry, subscribers, bound stores and a tracing channel. It returns what the module did.
// It has no array destructuring, no spread and no for...of, because it runs while those protocols are replaced.
function scenario(dc, AsyncLocalStorage, id) {
  const name = "scenario-" + id;
  const channel = dc.channel(name);
  const first = new AsyncLocalStorage();
  const second = new AsyncLocalStorage();
  const messages = [];
  const onMessage = (message, channelName) => messages.push(channelName === name ? message : "wrong name");
  const out = {};

  out.sameChannel = dc.channel(name) === channel;
  out.hasSubscribersBefore = dc.hasSubscribers(name);
  dc.subscribe(name, onMessage);
  out.hasSubscribers = dc.hasSubscribers(name);
  channel.bindStore(first, () => "first");
  channel.bindStore(second, () => "second");
  channel.bindStore(second, data => "second of " + data);
  out.runStores = channel.runStores(
    "data",
    function (a, b) {
      return first.getStore() + ", " + second.getStore() + ", " + this + ", " + a + b;
    },
    "this",
    "a",
    "b",
  );
  out.published = messages.join();
  out.unbindStore = [channel.unbindStore(first), channel.unbindStore(first), channel.unbindStore(second)].join();
  out.unsubscribe = dc.unsubscribe(name, onMessage);
  out.inactiveAfter = !channel.hasSubscribers && channel._stores === undefined;

  const tracing = dc.tracingChannel(name);
  const events = [];
  const handlers = {
    start: () => events.push("start"),
    end: () => events.push("end"),
    asyncStart: () => events.push("asyncStart"),
    asyncEnd: () => events.push("asyncEnd"),
    error: () => events.push("error"),
  };
  tracing.subscribe(handlers);
  tracing.start.bindStore(first, () => "traced");
  out.traceSync = tracing.traceSync(() => first.getStore());
  tracing.traceCallback(
    callback => callback(null, first.getStore()),
    0,
    {},
    undefined,
    (error, result) => {
      out.traceCallback = result;
    },
  );
  tracing.tracePromise(() => {
    out.tracePromise = first.getStore();
    return Promise.resolve();
  });
  out.events = events.join();
  out.tracingUnsubscribe = tracing.unsubscribe(handlers);
  out.unbindStart = tracing.start.unbindStore(first);
  return out;
}

// Puts a function that throws in the place of a member. A call of it shows up as the error of the scenario.
function replace(label, object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, {
    value() {
      throw new Error("called " + label);
    },
  });
  return () => Object.defineProperty(object, key, descriptor);
}

function attempt(dc, AsyncLocalStorage, id) {
  try {
    return scenario(dc, AsyncLocalStorage, id);
  } catch (error) {
    return String(error);
  }
}

// The registry of channels reads with `get`. The loops over the five channels of a tracing channel used the array iterator.
if (mode === "a member after the module loaded") {
  const dc = require("node:diagnostics_channel");
  const { AsyncLocalStorage } = require("node:async_hooks");
  const members = [
    ["Map.prototype.get", Map.prototype, "get"],
    ["Array.prototype[Symbol.iterator]", Array.prototype, Symbol.iterator],
    ["%ArrayIteratorPrototype%.next", Object.getPrototypeOf([][Symbol.iterator]()), "next"],
  ];
  const untouched = scenario(dc, AsyncLocalStorage, "untouched");
  const changed = {};
  for (let i = 0; i < members.length; i++) {
    const restore = replace(members[i][0], members[i][1], members[i][2]);
    let result;
    try {
      result = attempt(dc, AsyncLocalStorage, i);
    } finally {
      restore();
    }
    if (JSON.stringify(result) !== JSON.stringify(untouched)) changed[members[i][0]] = result;
  }
  console.log(JSON.stringify({ untouched, members: members.length, changed }));
}

// Nothing of Bun's library is loaded before the replacements. The module must take neither the global nor a member.
if (mode === "the Map global and the members the registry uses, before the module loads") {
  const RealMap = Map;
  let made = 0;
  const restores = [];
  let dc;
  try {
    restores.push(replace("Map.prototype.get", Map.prototype, "get"));
    restores.push(replace("Map.prototype.set", Map.prototype, "set"));
    restores.push(replace("Map.prototype.delete", Map.prototype, "delete"));
    globalThis.Map = class extends RealMap {
      constructor(iterable) {
        super(iterable);
        made++;
      }
    };
    dc = require("node:diagnostics_channel");
  } finally {
    globalThis.Map = RealMap;
    for (let i = 0; i < restores.length; i++) restores[i]();
  }
  const madeWhileLoading = made;
  const result = attempt(dc, require("node:async_hooks").AsyncLocalStorage, "restored");
  console.log(JSON.stringify({ result, madeAfterTheLoad: made - madeWhileLoading }));
}

// The modules of Bun that make their channels when they load. The registry of channels is a subclass of Map,
// so a call that reaches the public `get` or `set` with a receiver that is no plain Map comes from the registry.
if (mode === "modules that make channels when they load") {
  const get = Map.prototype.get;
  const set = Map.prototype.set;
  const calls = [];
  const record = (map, method) => {
    if (Object.getPrototypeOf(map) !== Map.prototype) calls.push(method);
  };
  try {
    Map.prototype.get = function (key) {
      record(this, "get");
      return get.call(this, key);
    };
    Map.prototype.set = function (key, value) {
      record(this, "set");
      return set.call(this, key, value);
    };
    require("node:http");
    require("node:http2");
    require("node:dgram").createSocket("udp4").close();
  } finally {
    Map.prototype.get = get;
    Map.prototype.set = set;
  }
  console.log(JSON.stringify({ calls: calls.join() }));
}

// The registry removes the entry of a collected channel in a FinalizationRegistry callback. An entry holds a WeakRef,
// so the number of WeakRef cells says how many entries the registry has.
if (mode === "the finalizer of the registry") {
  const dc = require("node:diagnostics_channel");
  const { heapStats } = require("bun:jsc");
  const weakRefs = () => heapStats().objectTypeCounts.WeakRef || 0;
  const mapDelete = Map.prototype.delete;
  const names = new Set();
  let deletes = 0;
  Map.prototype.delete = function (key) {
    if (names.has(key)) deletes++;
    return mapDelete.call(this, key);
  };
  const before = weakRefs();
  (function () {
    for (let i = 0; i < 500; i++) {
      const name = "collected-" + i;
      names.add(name);
      dc.channel(name);
    }
  })();
  const stored = weakRefs() - before;
  (async () => {
    let entries;
    try {
      // The callbacks run in the turn after a collection. The next collection frees the cells of the removed entries.
      // A few channels can stay alive and keep their entries. A finalizer that removes nothing leaves all 500.
      for (let turn = 0; turn < 10; turn++) {
        Bun.gc(true);
        entries = weakRefs() - before;
        if (entries < 50) break;
        await new Promise(setImmediate);
      }
    } finally {
      Map.prototype.delete = mapDelete;
    }
    console.log(JSON.stringify({ stored, deletes, entriesGone: entries < 50 || entries }));
  })();
}
