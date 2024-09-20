// usually returns x, but overridden if x is a boxed String or equal to globalThis
// to overcome differences in bun vs. node's logging
function describeValue(x) {
  if (x == globalThis) {
    return "globalThis";
  } else if (x instanceof String) {
    return `boxed String: ${x.toString()}`;
  } else {
    return x;
  }
}

function printValues() {
  console.log(`this = ${typeof this}`, describeValue(this));
  console.log(`${arguments.length} arguments`);
  for (let i = 0; i < arguments.length; i++) {
    console.log(`argument ${i} = ${typeof arguments[i]}`, describeValue(arguments[i]));
  }
  return "hello";
}

function printThisStrict() {
  "use strict";
  console.log(`in strict mode, this = ${typeof this}`, describeValue(this));
}

module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
  return {
    ...nativeModule,

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
        console.log("returned", describeValue(ret));
        console.log("constructor is", ret.constructor.name);
      }
    },

    call_js_functions_from_native() {
      console.log(
        "nativeModule.run_function_from_js returned",
        nativeModule.run_function_from_js(printValues, 1, 2, 3, { foo: "bar" }),
      );

      nativeModule.run_function_from_js(printThisStrict, 42);

      try {
        nativeModule.run_function_from_js(function () {
          printValues.apply(this, arguments);
          throw new Error("oh no");
        }, null);

        console.log("nativeModule.run_function_from_js did not throw");
      } catch (e) {
        console.log("nativeModule.run_function_from_js threw:", e.toString());
      }
    },

    call_native_function_from_native() {
      console.log(
        "nativeModule.run_function_from_js returned",
        nativeModule.run_function_from_js(nativeModule.create_function_with_data(), null),
      );
    },
  };
};
