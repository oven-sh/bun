module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
  return {
    ...nativeModule,

    test_v8_return_value_set_uint32() {
      for (const n of [0, 70000, 2147483647, 2147483648, 4000000000, 4294967295]) {
        console.log(n, "=>", nativeModule.test_v8_return_value_set_uint32(n));
      }
    },

    test_v8_return_value_set_int32() {
      for (const n of [0, 70000, 2147483647, -1, -70000, -2147483648]) {
        console.log(n, "=>", nativeModule.test_v8_return_value_set_int32(n));
      }
    },

    test_v8_object_has_delete() {
      const obj = { present: 1, 0: "zero" };
      nativeModule.test_v8_object_has_delete(obj);
      console.log("after:", JSON.stringify(obj));
    },

    test_v8_function_call() {
      nativeModule.test_v8_function_call((a, b) => a + b);
    },

    test_v8_value_coercions() {
      for (const v of [42, "42", true, " 7.5 "]) {
        console.log("--", JSON.stringify(v));
        nativeModule.test_v8_value_coercions(v);
      }
    },

    test_v8_string_utf8value() {
      const throwing = {
        toString() {
          throw new Error("nope");
        },
      };
      for (const v of ["hello", 123, "caf\u00e9", "\u{1f600}", Symbol("s"), throwing]) {
        try {
          nativeModule.test_v8_string_utf8value(v);
          console.log("did not throw");
        } catch (e) {
          console.log("threw:", e.constructor.name);
        }
      }
    },

    test_v8_integer_value_out_of_range() {
      for (const v of [Infinity, -Infinity, 1e300, -1e300, NaN, 0, 42]) {
        nativeModule.test_v8_integer_value_out_of_range(v);
      }
    },

    test_v8_throw_exception() {
      try {
        nativeModule.test_v8_throw_exception();
        console.log("did not throw");
      } catch (e) {
        console.log(e.constructor.name, e.message);
      }
    },

    test_v8_exception_constructors() {
      const errs = nativeModule.test_v8_exception_constructors();
      for (const e of errs) {
        console.log(e.constructor.name, e.message);
      }
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
