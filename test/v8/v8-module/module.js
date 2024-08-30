module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
  return {
    ...nativeModule,

    test_v8_global() {
      console.log(nativeModule.global_get());
      nativeModule.global_set(123);
      console.log(nativeModule.global_get());
      nativeModule.global_set({ foo: 5, bar: ["one", "two", "three"] });
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log(JSON.stringify(nativeModule.global_get()));
    },

    test_v8_function_template() {
      const f = nativeModule.create_function_with_data();
      if (process.isBun) {
        Bun.gc(true);
      }
      console.log(f());
    },

    test_v8_object_set_failure() {
      const object = {};
      const key = {
        toString() {
          throw new Error("thrown by key.toString()");
        },
      };

      try {
        nativeModule.set_field_from_js(object, key);
        console.log("no error while setting with key that throws in toString()");
      } catch (e) {
        console.log(e.toString());
      }

      const setterThrows = new Proxy(object, {
        set(obj, prop, value) {
          throw new Error(`proxy setting ${prop} to ${value}`);
        },
      });

      try {
        nativeModule.set_field_from_js(setterThrows, "xyz");
        console.log("no error while setting on Proxy that throws");
      } catch (e) {
        console.log(e.toString());
      }

      console.log("after setting, object.xyz is", object.xyz);

      const onlyGetter = {
        get foo() {
          return 5;
        },
      };

      try {
        nativeModule.set_field_from_js(onlyGetter, "foo");
        // apparently this is expected in node
        console.log("no error while setting a key that only has a getter");
      } catch (e) {
        console.log(e.toString());
      }

      console.log("after setting, onlyGetter.foo is", onlyGetter.foo);
    },
  };
};
