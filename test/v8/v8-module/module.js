const path = require("node:path");
const { Worker, parentPort } = require("node:worker_threads");

module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);

  // The Worker runs a function of this module, which main.js starts like a test of the main thread.
  function startWorker(testName, ...args) {
    const argv = [testName, JSON.stringify(args), "null", debugMode ? "debug" : "release"];
    // What the Worker writes about its uncaught error is not the output of a test.
    const worker = new Worker(path.join(__dirname, "main.js"), { argv, stderr: true });
    worker.stderr.resume();
    worker.on("error", () => {});
    return worker;
  }

  // Of all threads of the process.
  const processorSeconds = () => process.resourceUsage().userCPUTime / 1e6;

  // Every wrap stays reachable: the collector of Node destroys a wrap that nothing refers to, and that of Bun does not yet.
  function makeWrapsWithCleanupHooks() {
    nativeModule.report_wraps_at_cleanup();
    const wraps = Array.from({ length: 1000 }, () => new nativeModule.WrapWithCleanupHook());
    globalThis.wraps = wraps;
    // What a close() method of an addon does to every 7th wrap before the end.
    const isDestroyed = index => index % 7 === 0;
    for (let i = 0; i < wraps.length; i += 7) nativeModule.destroy_wrap(wraps[i]);
    // Every 10th wrap owns the one 5 before it, so its hook deletes both, and the hook of the older one must not run.
    for (let i = 10; i < wraps.length; i += 10) {
      if (!isDestroyed(i) && !isDestroyed(i - 5)) nativeModule.adopt_wrap(wraps[i], wraps[i - 5]);
    }
  }

  return {
    ...nativeModule,

    test_v8_cleanup_hooks() {
      nativeModule.add_cleanup_hooks_that_add_and_remove();
      console.log("the script ends");
    },

    test_v8_cleanup_hooks_after_process_exit() {
      nativeModule.add_cleanup_hooks("1", "2", "3");
      console.log("process.exit() is next");
      process.exit(0);
    },

    test_v8_cleanup_hooks_of_worker(end) {
      const worker = startWorker("add_cleanup_hooks_and_end", end);
      worker.on("message", () => worker.terminate());
      worker.on("exit", () => console.log("the Worker has exited"));
    },

    add_cleanup_hooks_and_end(end) {
      nativeModule.add_cleanup_hooks("1", "2", "3");
      switch (end) {
        case "process.exit()":
          process.exit(0);
        case "worker.terminate()":
          parentPort.postMessage("ready");
          setInterval(() => {}, 1000);
          break;
        case "an uncaught error":
          throw new Error("the Worker ends with this error");
      }
    },

    // The outer Worker ends while the inner one, which waits to be terminated, is alive.
    test_v8_cleanup_hooks_of_nested_workers() {
      startWorker("add_cleanup_hooks_and_leave_a_worker").on("exit", () => console.log("the outer Worker has exited"));
    },

    add_cleanup_hooks_and_leave_a_worker() {
      nativeModule.add_cleanup_hooks("of the outer Worker");
      startWorker("add_cleanup_hooks_and_end", "worker.terminate()").on("message", () => process.exit(0));
    },

    test_v8_object_wrap_cleanup_hooks() {
      makeWrapsWithCleanupHooks();
      console.log("the script ends");
    },

    test_v8_object_wrap_cleanup_hooks_of_worker() {
      startWorker("make_wraps_with_cleanup_hooks").on("exit", () => console.log("the Worker has exited"));
    },

    make_wraps_with_cleanup_hooks: makeWrapsWithCleanupHooks,

    // Prints the processor seconds from the moment before a Worker makes `few` wraps to its exit, which runs their hooks, and those for four times as many.
    test_v8_object_wrap_cleanup_hooks_cost(few) {
      function measure(count, done) {
        let before;
        startWorker("report_processor_seconds_and_create_bare_wraps", count)
          .on("message", seconds => (before = seconds))
          .on("exit", () => done(processorSeconds() - before));
      }
      measure(few, withFew => {
        measure(4 * few, withMany => console.log(JSON.stringify({ withFew, withMany })));
      });
    },

    report_processor_seconds_and_create_bare_wraps(count) {
      nativeModule.report_wraps_at_cleanup();
      parentPort.postMessage(processorSeconds());
      nativeModule.create_bare_wraps(count);
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
