module.exports = debugMode => {
  const nativeModule = require(`./build/${debugMode ? "Debug" : "Release"}/v8tests`);
  return {
    ...nativeModule,
    test_v8_global() {
      console.log(nativeModule.global_get());
      nativeModule.global_set("abc");
      console.log(nativeModule.global_get());
    },
  };
};
