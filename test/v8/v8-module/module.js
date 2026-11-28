const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

function thrower(name) {
  return function () {
    console.log(name, "runs");
    throw new Error(`thrown by ${name}`);
  };
}

function revokedProxy() {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

// Cases for run_entry in main.cpp: [entry, description, a, b]. In each one the entry runs JavaScript that throws.
const entriesThatThrow = {
  calls: () => [
    ["Function::Call", "a function that throws", thrower("function")],
    ["Function::Call", "a class constructor", class {}],
    ["Function::NewInstance", "a constructor that throws", thrower("constructor")],
    ["Function::NewInstance", "an arrow function", () => {}],
  ],
  properties: () => [
    ["Object::Get(key)", "a getter that throws", Object.defineProperty({}, "key", { get: thrower("getter") }), "key"],
    ["Object::Get(key)", "a Proxy trap that throws", new Proxy({}, { get: thrower("get trap") }), "key"],
    ["Object::Get(key)", "a key whose toString throws", {}, { toString: thrower("toString") }],
    ["Object::Get(index)", "a getter that throws", Object.defineProperty({}, 0, { get: thrower("getter") })],
    ["Object::Get(index)", "a Proxy trap that throws", new Proxy({}, { get: thrower("get trap") })],
    ["Object::Set(key)", "a setter that throws", Object.defineProperty({}, "key", { set: thrower("setter") }), "key"],
    ["Object::Set(key)", "a Proxy trap that throws", new Proxy({}, { set: thrower("set trap") }), "key"],
    ["Object::Set(index)", "a setter that throws", Object.defineProperty({}, 0, { set: thrower("setter") })],
    ["Object::Set(index)", "a Proxy trap that throws", new Proxy({}, { set: thrower("set trap") })],
    [
      "Object::DefineOwnProperty",
      "a Proxy trap that throws",
      new Proxy({}, { defineProperty: thrower("defineProperty trap") }),
      "key",
    ],
    ["Array::Iterate", "an element getter that throws", Object.defineProperty([], 0, { get: thrower("getter") })],
  ],
  conversions: () => [
    ["Value::ToString", "a toString that throws", { toString: thrower("toString") }],
    ["Value::ToInt32", "a valueOf that throws", { valueOf: thrower("valueOf") }],
    ["Value::ToInteger", "a valueOf that throws", { valueOf: thrower("valueOf") }],
  ],
  oneCall: () => [["Function::Call", "a function that throws", thrower("function")]],
  makeCallback: () => [["node::MakeCallback", "a callback that throws", thrower("callback")]],
  // The engine or the addon throws, and no JavaScript runs.
  withoutJavaScript: () => [
    ["Object::Get(key)", "a revoked Proxy", revokedProxy(), "key"],
    ["Object::Get(key)", "a key that has no primitive value", {}, Object.create(null)],
    ["Object::Get(index)", "a revoked Proxy", revokedProxy()],
    ["Object::Set(key)", "a revoked Proxy", revokedProxy(), "key"],
    ["Object::DefineOwnProperty", "a revoked Proxy", revokedProxy(), "key"],
    ["Value::ToString", "a Symbol", Symbol()],
    ["Value::ToInt32", "a Symbol", Symbol()],
    ["Value::ToInt32", "a BigInt", 1n],
    ["Value::ToInteger", "a Symbol", Symbol()],
    ["Isolate::ThrowException", "an Error"],
    ["Isolate::ThrowError", "a message"],
    ["Array::New, the callback throws", "two elements"],
    ["Array::Iterate, the callback throws", "one element", [1]],
  ],
  typedArray: () => [["Uint8Array::New", "an ArrayBuffer that is too short", new ArrayBuffer(8)]],
};

// The tests throw errors with this prefix. Every other error is the engine's, and V8 and JSC word those differently.
function describeError(error) {
  return String(error.message).startsWith("thrown by") ? error.message : error.constructor.name;
}

module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);

  // Runs each case in a libuv callback of its own, `times` times in a row.
  async function runEntriesFromEventLoop(cases, times) {
    for (const [entry, description, a, b] of cases) {
      console.log(`${entry} with ${description}`);
      const { promise, resolve } = Promise.withResolvers();
      nativeModule.run_entry_from_event_loop(entry, times, a, b, () => {
        console.log("after() runs");
        setImmediate(resolve);
      });
      await promise;
    }
  }

  return {
    ...nativeModule,

    test_entries_throw_from_event_loop(group, times = 1) {
      process.on("uncaughtException", error => console.log("uncaughtException:", describeError(error)));
      runEntriesFromEventLoop(entriesThatThrow[group](), times);
    },

    test_entry_throws_from_event_loop_with_queued_jobs() {
      process.on("uncaughtException", error => console.log("uncaughtException:", describeError(error)));
      const throwAfterQueueing = () => {
        process.nextTick(() => console.log("tick"));
        Promise.resolve().then(() => console.log("microtask"));
        throw new Error("thrown by function");
      };
      runEntriesFromEventLoop([["Function::Call", "a function that queues jobs and throws", throwAfterQueueing]], 1);
    },

    test_entry_throws_from_event_loop_and_listener_calls_addon() {
      process.on("uncaughtException", error => {
        console.log("uncaughtException:", describeError(error));
        nativeModule.run_entry_from_js("Object::Get(key)", { key: 1 }, "key");
      });
      runEntriesFromEventLoop(entriesThatThrow.oneCall(), 1);
    },

    test_entry_throws_from_event_loop_without_listener() {
      process.on("uncaughtExceptionMonitor", error => console.log("uncaughtExceptionMonitor:", describeError(error)));
      process.on("exit", code => console.log("exit:", code));
      runEntriesFromEventLoop(entriesThatThrow.oneCall(), 1);
    },

    // An uncaught exception ends a Worker that has no listener. The addon's callback still runs to its end.
    test_entry_throws_from_event_loop_in_worker() {
      const events = [];
      const worker = new Worker(path.join(__dirname, "main.js"), {
        argv: ["entry_throws_from_event_loop_in_this_worker", "[]", "null", debugMode ? "debug" : "release"],
      });
      worker.on("error", error => events.push(`worker error: ${describeError(error)}`));
      // The Worker's thread has left the addon's callback when it exits.
      worker.on("exit", code => console.log([...events, `worker exit code: ${code}`].join("\n")));
    },

    // console.log in a Worker of Node goes through the main thread. A write to the descriptor keeps the order.
    entry_throws_from_event_loop_in_this_worker() {
      const log = line => fs.writeSync(1, line + "\n");
      process.on("exit", code => log(`worker exit handler: ${code}`));
      const throws = () => {
        log("function runs");
        throw new Error("thrown by function");
      };
      nativeModule.run_entry_from_event_loop("Function::Call", 2, throws, undefined, () => log("after() runs"));
    },

    test_entries_throw_from_js(...groups) {
      process.on("uncaughtException", error => console.log("uncaughtException:", describeError(error)));
      for (const [entry, description, a, b] of groups.flatMap(group => entriesThatThrow[group]())) {
        console.log(`${entry} with ${description}`);
        try {
          nativeModule.run_entry_from_js(entry, a, b);
          console.log("did not throw");
        } catch (error) {
          console.log("JS caller caught:", describeError(error));
        }
      }
    },

    test_v8_function_script_origin() {
      function namedFunction(a, b) {
        return a + b;
      }
      const arrowFunction = (a, b) => a + b;
      class DefaultConstructor {
        method() {}
      }
      class ExplicitConstructor {
        constructor() {}
      }
      class Derived extends DefaultConstructor {}
      const AnonymousClass = class {};
      const cases = [
        ["named function", namedFunction],
        ["arrow function", arrowFunction],
        ["class with default constructor", DefaultConstructor],
        ["class with explicit constructor", ExplicitConstructor],
        ["derived class with default constructor", Derived],
        ["anonymous class expression", AnonymousClass],
        ["class method", DefaultConstructor.prototype.method],
        ["builtin function", Array.prototype.map],
        ["bound function", namedFunction.bind(null)],
        ["native addon function", nativeModule.get_function_script_origin],
      ];
      for (const [description, fn] of cases) {
        console.log(`====== ${description}`);
        const { file, line, column } = nativeModule.get_function_script_origin(fn);
        console.log("file:", typeof file === "string" ? path.basename(file) : file);
        console.log("file is absolute:", typeof file === "string" && path.isAbsolute(file));
        console.log("line:", line, "column:", column);
      }
    },

    test_v8_value_to_int32() {
      const cases = [
        ["int", 42],
        ["negative int", -7],
        ["fraction", 3.99],
        ["negative fraction", -3.99],
        ["INT32_MAX + 1", 2 ** 31],
        ["UINT32_MAX + 6", 2 ** 32 + 5],
        ["INT32_MIN - 1", -(2 ** 31) - 1],
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["numeric string", "123"],
        ["hex string", "0x10"],
        ["true", true],
        ["null", null],
        ["undefined", undefined],
        ["object with valueOf", { valueOf: () => 77.5 }],
        [
          "object with throwing valueOf",
          {
            valueOf() {
              throw new Error("valueOf threw");
            },
          },
        ],
      ];
      for (const [description, value] of cases) {
        console.log(`====== ${description}`);
        try {
          console.log("result:", nativeModule.perform_to_int32(value));
        } catch (e) {
          console.log("threw:", e.message);
        }
      }
    },

    // Bun only: 48k collected instances with 128 internal fields each. Their
    // field storage is about 2 KB per instance, 100 MiB if none of it is freed.
    test_v8_internal_field_object_leak() {
      nativeModule.create_objects_with_internal_fields(256, 128);
      Bun.gc(true);
      const before = process.memoryUsage.rss();
      for (let i = 0; i < 24; i++) {
        nativeModule.create_objects_with_internal_fields(2000, 128);
        Bun.gc(true);
      }
      const after = process.memoryUsage.rss();
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    },

    test_v8_global() {
      console.log("global initial value =", nativeModule.global_get());

      nativeModule.global_set(123);
      console.log("global after setting to 123 =", nativeModule.global_get());

      nativeModule.global_set({ foo: 5, bar: ["one", "two", "three"] });
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log("global after setting to object =", JSON.stringify(nativeModule.global_get()));

      nativeModule.global_set(true);
      console.log("global after setting to true =", nativeModule.global_get());
    },

    test_v8_function_template() {
      const f = nativeModule.create_function_with_data();
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log(f());
    },

    test_v8_function_template_set_class_name() {
      const f = nativeModule.test_v8_function_template_set_class_name();
      console.log("f.name =", f.name);
    },

    test_v8_define_own_property() {
      const obj = nativeModule.test_v8_define_own_property();
      for (const key of ["writable", "readonly", "hidden"]) {
        const d = Object.getOwnPropertyDescriptor(obj, key);
        console.log(
          key,
          "=",
          d.value,
          "writable =",
          d.writable,
          "enumerable =",
          d.enumerable,
          "configurable =",
          d.configurable,
        );
      }
      console.log("enumerable keys =", JSON.stringify(Object.keys(obj).sort()));
    },

    test_v8_bigint() {
      const big = nativeModule.test_v8_bigint();
      console.log("typeof =", typeof big);
      console.log("value =", big.toString());
      console.log("is expected =", big === 123456789012345n);
    },

    test_v8_prototype_template() {
      const inst = nativeModule.test_v8_prototype_template();
      console.log("protoMethod() =", inst.protoMethod());
      console.log("nativeProp =", inst.nativeProp);
      console.log("protoMethod is own =", Object.prototype.hasOwnProperty.call(inst, "protoMethod"));
    },

    test_v8_return_value_from_inner_scope() {
      // The native functions invoke this after their inner handle scope closed,
      // while the callback is still on the stack, so the collection runs in the
      // window where only the preserved return value keeps the cell alive.
      // No-op under Node so the output matches.
      const maybeGc = () => {
        if (process.isBun) {
          Bun.gc(true);
        }
      };
      console.log("string =", nativeModule.return_string_from_inner_scope(1, maybeGc));
      console.log("number =", nativeModule.return_heap_number_from_inner_scope(1, maybeGc));
      console.log("element =", nativeModule.return_array_element_from_iterate(["one", "two", "three"], maybeGc));
      console.log("accessor =", nativeModule.return_accessor_value_from_inner_scope());
    },

    test_v8_function_call() {
      function target(a, b, c) {
        if (arguments.length === 0) return this && this.tag;
        return a + 1;
      }
      const err = nativeModule.test_v8_function_call(target);
      if (err) throw new Error(err);
    },

    test_v8_map() {
      const map = new Map();
      const ret = nativeModule.test_v8_map(map);
      if (typeof ret === "string") throw new Error(ret);
      console.log("size =", map.size);
      console.log("has a =", map.has("a"));
      console.log("has b =", map.has("b"));
      console.log("get b =", map.get("b"));
    },

    test_v8_exception() {
      try {
        nativeModule.test_v8_exception();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.constructor.name, e.message);
      }
    },

    test_v8_exception_empty_message() {
      for (const e of nativeModule.test_v8_exception_empty_message()) {
        console.log(e.constructor.name, "message =", JSON.stringify(e.message), "own =", Object.hasOwn(e, "message"));
      }
    },

    test_v8_throw_error_empty_message() {
      try {
        nativeModule.test_v8_throw_error_empty_message();
        console.log("did not throw");
      } catch (e) {
        const own = Object.hasOwn(e, "message");
        console.log("caught", e.constructor.name, "message =", JSON.stringify(e.message), "own =", own);
      }
    },

    test_v8_new_values_with_pending_exception() {
      try {
        nativeModule.test_v8_new_values_with_pending_exception();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
    },

    print_native_function() {
      nativeModule.print_values_from_js(nativeModule.create_function_with_data());
    },

    call_function_with_weird_this_values() {
      for (const thisValue of [null, undefined, 5, "abc"]) {
        const ret = nativeModule.return_this.call(thisValue);
        console.log("typeof =", typeof ret);
        if (ret == globalThis) {
          console.log("returned globalThis");
        } else if (ret instanceof String) {
          console.log("returned boxed String:", ret.toString());
        } else {
          console.log("returned", ret);
        }
        console.log("constructor is", ret.constructor.name);
      }
    },

    call_function_bare_through_closure() {
      const { return_this } = nativeModule;
      // return_this is captured by keep, so the bare call below is resolved through the closure's
      // scope object, which JSC leaves in the call's this slot. The callback must still see the
      // sloppy-mode receiver (globalThis), never that scope object.
      function keep() {
        return return_this;
      }
      console.log("bare call returned globalThis:", return_this() === globalThis);
      keep();
    },

    native_accessor_holder_on_property_access() {
      const obj = nativeModule.create_object_with_holder_accessor();
      console.log("getter holder is the object:", obj.holder === obj);
      obj.holder = 1;
      console.log("setter holder is the object:", nativeModule.global_get() === obj);
    },

    // Bun only: V8 itself installs a native data property as a data property, so Bun is the one
    // runtime where its getter and setter exist as functions that can be called with any receiver.
    native_accessor_holder_for_weird_receivers() {
      const obj = nativeModule.create_object_with_holder_accessor();
      const { get, set } = Object.getOwnPropertyDescriptor(obj, "holder");
      // get and set are captured by keep, so the bare calls below are resolved through the
      // closure's scope object, which JSC leaves in the call's this slot.
      function keep() {
        return [get, set];
      }
      const describe = value => {
        if (value === globalThis) return "globalThis";
        if (value === obj) return "the object";
        if (value instanceof Number) return "a Number object";
        return typeof value;
      };
      const holderSeenBySetter = receiver => {
        nativeModule.global_set(undefined);
        set.call(receiver, 1);
        return nativeModule.global_get();
      };
      console.log("bare getter():", describe(get()));
      console.log("getter.call(undefined):", describe(get.call(undefined)));
      console.log("getter.call(null):", describe(get.call(null)));
      console.log("getter.call(5):", describe(get.call(5)));
      console.log("getter.call(obj):", describe(get.call(obj)));
      nativeModule.global_set(undefined);
      set(1);
      console.log("bare setter():", describe(nativeModule.global_get()));
      console.log("setter.call(undefined):", describe(holderSeenBySetter(undefined)));
      console.log("setter.call(null):", describe(holderSeenBySetter(null)));
      console.log("setter.call(5):", describe(holderSeenBySetter(5)));
      console.log("setter.call(obj):", describe(holderSeenBySetter(obj)));
      keep();
    },

    test_uv_queue_work_on_current_event_loop() {
      const rc = nativeModule.queue_work_and_call((...args) => console.log("after_work_cb", ...args));
      console.log("uv_queue_work", rc);
    },

    test_v8_object_get_set_exceptions() {
      for (const key of [0, "key"]) {
        for (const access of ["get", "set"]) {
          const name = `perform_object_${access}_by_${typeof key == "number" ? "index" : "key"}`;
          const nativeFunction = nativeModule[name];
          if (typeof nativeFunction !== "function") throw new Error(name);

          const normal = { [key]: 5 };
          const accessor = {};
          Object.defineProperty(accessor, key, {
            [access](...args) {
              throw new Error("exception from accessor");
            },
          });
          const proxy = new Proxy(
            {},
            {
              [access](...args) {
                throw new Error("exception from proxy");
              },
            },
          );
          const readonly = {};
          Object.defineProperty(readonly, key, { configurable: true, writable: false, enumerable: true, value: "bar" });

          for (const [object, description] of [
            [normal, "plain object"],
            [accessor, "object with accessor that throws"],
            [proxy, "proxy with handler that throws"],
            [readonly, "plain object with readonly property"],
          ]) {
            console.log(`======\n${access} ${key} on ${description}`);
            try {
              nativeFunction(object, key, "foo");
              console.log("did not throw");
              if (object === normal || object === readonly) console.log("now value is", object[key]);
            } catch (e) {
              console.log(`threw: ${e.message}`);
            }
          }
        }
      }
    },
  };
};
