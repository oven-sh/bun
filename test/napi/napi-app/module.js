const nativeTests = require("./build/Release/napitests.node");

nativeTests.test_napi_class_constructor_handle_scope = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  const x = new NapiClass();
  console.log("x.foo =", x.foo);
};

nativeTests.test_napi_handle_scope_finalizer = async () => {
  // Create a weak reference, which will be collected eventually
  // Pass false in Node.js so it does not create a handle scope
  nativeTests.create_ref_with_finalizer(Boolean(process.isBun));

  // Wait until it actually has been collected by ticking the event loop and forcing GC
  while (!nativeTests.was_finalize_called()) {
    await new Promise(resolve => {
      setTimeout(() => resolve(), 0);
    });
    if (process.isBun) {
      Bun.gc(true);
    } else if (global.gc) {
      global.gc();
    }
  }
};

nativeTests.test_promise_with_threadsafe_function = async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  // create_promise_with_threadsafe_function returns a promise that calls our function from another
  // thread (via napi_threadsafe_function) and resolves with its return value
  return await nativeTests.create_promise_with_threadsafe_function(() => 1234);
};

nativeTests.test_throw_in_completion = async () => {
  nativeTests.create_promise_with_threadsafe_function(() => {
    throw new Error("1");
  });
  nativeTests.create_promise_with_threadsafe_function(() => {
    throw new Error("2");
  });
};

nativeTests.test_throw_in_two_completions = () => {
  return Promise.all([nativeTests.create_promise(), nativeTests.create_promise()]);
};

module.exports = nativeTests;
