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
  };
};
