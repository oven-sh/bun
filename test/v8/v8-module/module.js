const path = require("node:path");

module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
  return {
    ...nativeModule,

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
    test_v8_object_set_native_data_property() {
      const proxyTarget = {};
      const { proxy: revoked, revoke } = Proxy.revocable({}, {});
      revoke();
      const fixed = {};
      Object.defineProperty(fixed, "fixed", { value: 1 });
      Object.defineProperty(fixed, "0", { value: 2 });
      const array = [1, 2];
      const [ctor, plain] = nativeModule.test_v8_object_set_native_data_property(
        new Proxy(proxyTarget, {}),
        revoked,
        fixed,
        array,
      );
      console.log("proxy target keys =", JSON.stringify(Object.keys(proxyTarget)));
      console.log("fixed =", fixed.fixed, fixed[0], "array length =", array.length);
      console.log("ctor.prototype is object =", typeof ctor.prototype === "object" && ctor.prototype !== null);
      console.log("plain[0] =", plain[0]);
      console.log("ctor.level =", ctor.level);
      ctor.level = "x";
      ctor.level = "y";
      console.log("setter calls =", nativeModule.get_object_accessor_set_count());
      console.log("ctor.level after set =", ctor.level);
      // V8 shows a native data property as a data property and Bun as an
      // accessor, so only the attributes are compared.
      const levelDesc = Object.getOwnPropertyDescriptor(ctor, "level");
      console.log("level attributes:", levelDesc.enumerable, levelDesc.configurable);
      console.log("plain.readOnly =", plain.readOnly);
      plain.readOnly = 1;
      console.log("plain.readOnly after sloppy assignment =", plain.readOnly);
      const readOnlyDesc = Object.getOwnPropertyDescriptor(plain, "readOnly");
      console.log("readOnly attributes:", readOnlyDesc.enumerable, readOnlyDesc.configurable);
      console.log("keys =", JSON.stringify(Object.keys(plain)));
      console.log("plain[Symbol.iterator] =", plain[Symbol.iterator]);
    },

    test_v8_function_template_has_instance() {
      const [ctor, constructed, fromObjectTemplate] = nativeModule.test_v8_function_template_has_instance();
      console.log("ObjectTemplate::New(isolate, F) instance instanceof F =", fromObjectTemplate instanceof ctor);
      const fromCreate = Object.create(ctor.prototype);
      console.log("Object.create(F.prototype) =", nativeModule.has_instance(fromCreate));
      console.log("instanceof for Object.create =", fromCreate instanceof ctor);
      Object.setPrototypeOf(constructed, {});
      console.log("reparented instance =", nativeModule.has_instance(constructed));
      console.log("instanceof for reparented =", constructed instanceof ctor);
      class Sub extends ctor {}
      const sub = new Sub();
      console.log("subclass instance =", nativeModule.has_instance(sub));
      console.log("plain =", nativeModule.has_instance({}));
      console.log("string =", nativeModule.has_instance("s"));
    },

    test_v8_node_buffer() {
      const u16 = new Uint16Array([0x6162, 0x6364, 0x6566]);
      const copy = nativeModule.test_v8_node_buffer(
        [Buffer.from("abc"), new Uint16Array(u16.buffer, 2, 2), u16.buffer, {}, "str", new DataView(u16.buffer, 1, 3)],
        ["héllo wörld", "\ud83d\ude00 surrogates \ud83d", "48656c6c6f", "SGVsbG8=", "SGVsbG8", "ab=", ""],
      );
      for (const [name, view] of [
        ["Buffer.alloc(32)", Buffer.alloc(32)],
        ["Buffer.from", Buffer.from("hello world")],
        ["new Uint8Array(32)", new Uint8Array(32)],
        ["Uint16Array at an offset", new Uint16Array(new ArrayBuffer(64), 8, 4)],
      ]) {
        const stable = nativeModule.buffer_data_is_stable(view, () => view.buffer.byteLength);
        console.log(name, "stable =", stable, "first bytes =", view[0], view[1]);
      }
      console.log(
        "copy is Buffer =",
        Buffer.isBuffer(copy),
        "proto ok =",
        Object.getPrototypeOf(copy) === Buffer.prototype,
      );
      console.log("copy =", JSON.stringify([...copy]), "toString =", JSON.stringify(copy.toString("latin1")));
      console.log("copy.buffer byteLength =", copy.buffer.byteLength, "offset =", copy.byteOffset);
    },

    test_v8_string_utf8_value() {
      try {
        nativeModule.utf8_value_with_pending_exception("still converted");
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
      nativeModule.test_v8_string_utf8_value([
        "plain",
        "h\u00e9\ud83d\ude00",
        "lone \ud83d surrogate",
        12.5,
        null,
        { toString: () => "from toString" },
        {
          toString() {
            throw new Error("toString threw");
          },
        },
        Symbol("sym"),
      ]);
    },

    test_v8_exception_range_and_syntax() {
      for (const e of nativeModule.test_v8_exception_range_and_syntax()) {
        console.log(
          e.constructor.name,
          "message =",
          JSON.stringify(e.message),
          "instanceof Error =",
          e instanceof Error,
        );
      }
      try {
        nativeModule.throw_range_error();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.constructor.name, e instanceof RangeError, e.message);
      }
    },

    test_v8_regexp() {
      nativeModule.test_v8_regexp([
        /abc/,
        /a\/b/gi,
        new RegExp(""),
        new RegExp("/", "my"),
        /x/dsu,
        /[\p{L}--[a-z]]/v,
        require("node:vm").runInNewContext("/from-vm/gi"),
        "not a regexp",
        { source: "fake", flags: "g" },
        Object.create(RegExp.prototype),
        new (class extends RegExp {})("sub", "g"),
      ]);
    },

    test_v8_symbol_get_iterator() {
      const iterable = {
        *[Symbol.iterator]() {
          yield "^/users/\\d+$";
          yield "^/posts/\\d+$";
          yield 42;
        },
      };
      nativeModule.test_v8_symbol_get_iterator(iterable, Symbol.iterator);
      nativeModule.test_v8_symbol_get_iterator(new Set(["a"]), Symbol.iterator);
    },

    test_v8_object_set_prototype_and_call() {
      const { proxy: revoked, revoke } = Proxy.revocable({}, {});
      revoke();
      const [groups, child] = nativeModule.test_v8_object_set_prototype_and_call(
        Object.freeze({}),
        function (a) {
          return `${this === undefined ? "undefined" : this === globalThis ? "global" : this.tag}:${arguments.length}:${a}`;
        },
        function () {
          throw new Error("callee threw");
        },
        new Proxy(
          {},
          {
            setPrototypeOf() {
              throw new Error("trap threw");
            },
          },
        ),
        revoked,
      );
      console.log("groups proto =", Object.getPrototypeOf(groups));
      console.log("groups has toString =", "toString" in groups);
      console.log(
        "child proto is plain object =",
        Object.getPrototypeOf(child) !== Object.prototype && typeof Object.getPrototypeOf(child) === "object",
      );
      const receiver = { tag: "js" };
      console.log(
        "call result =",
        nativeModule.call_as_function(
          function (a, b) {
            return `${this.tag}:${arguments.length}:${a}:${b}`;
          },
          receiver,
          1,
          "two",
        ),
      );
      try {
        nativeModule.call_as_function(function () {
          throw new Error("callee threw");
        }, receiver);
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
      try {
        nativeModule.call_as_function({}, receiver);
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.constructor.name);
      }
    },

    test_v8_value_conversions() {
      const ab = new Uint8Array([9, 8]).buffer;
      const sab = new SharedArrayBuffer(4);
      new Uint8Array(sab)[0] = 5;
      nativeModule.test_v8_value_conversions([
        ab,
        sab,
        new Uint8Array(ab),
        new DataView(ab),
        Buffer.from("x"),
        new Proxy(ab, {}),
        [],
        {},
        "12.5",
        "",
        "abc",
        0,
        -0,
        NaN,
        1e21,
        true,
        false,
        null,
        undefined,
        { valueOf: () => 3 },
      ]);
      for (const value of [
        "7",
        { valueOf: () => 3 },
        {
          valueOf() {
            throw new Error("valueOf threw");
          },
        },
        10n,
        Symbol("s"),
        null,
        undefined,
      ]) {
        try {
          const object = nativeModule.number_value_then_to_object(value);
          console.log("returned", typeof object, object instanceof Object);
        } catch (e) {
          // The message of an engine TypeError differs between V8 and JSC.
          console.log("caught", e.constructor.name, e.message === "valueOf threw" ? e.message : "");
        }
      }
    },

    test_v8_global_reset_cycle() {
      nativeModule.test_v8_global_reset_cycle(100);
    },
  };
};
