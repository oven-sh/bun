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

nativeTests.test_get_exception = (_, value) => {
  function thrower() {
    throw value;
  }
  try {
    const result = nativeTests.call_and_get_exception(thrower);
    console.log("got same exception back?", result === value);
  } catch (e) {
    console.log("native module threw", typeof e, e);
    throw e;
  }
};

nativeTests.test_get_property = () => {
  const objects = [
    {},
    { foo: "bar" },
    {
      get foo() {
        throw new Error("get foo");
      },
    },
    {
      set foo(newValue) {},
    },
    new Proxy(
      {},
      {
        get(_target, key) {
          throw new Error(`proxy get ${key}`);
        },
      },
    ),
  ];
  const keys = [
    "foo",
    {
      toString() {
        throw new Error("toString");
      },
    },
    {
      [Symbol.toPrimitive]() {
        throw new Error("Symbol.toPrimitive");
      },
    },
  ];

  for (const object of objects) {
    for (const key of keys) {
      try {
        const ret = nativeTests.perform_get(object, key);
        console.log("native function returned", ret);
      } catch (e) {
        console.log("threw", e.toString());
      }
    }
  }
};

nativeTests.test_throw_functions_exhaustive = () => {
  for (const errorKind of ["error", "type_error", "range_error", "syntax_error"]) {
    for (const code of [undefined, "", "error code"]) {
      for (const msg of [undefined, "", "error message"]) {
        try {
          nativeTests.throw_error(code, msg, errorKind);
          console.log(`napi_throw_${errorKind}(${code ?? "nullptr"}, ${msg ?? "nullptr"}) did not throw`);
        } catch (e) {
          console.log(
            `napi_throw_${errorKind} threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`,
          );
        }
      }
    }
  }
};

nativeTests.test_create_error_functions_exhaustive = () => {
  for (const errorKind of ["error", "type_error", "range_error", "syntax_error"]) {
    // null (JavaScript null) is changed to nullptr by the native function
    for (const code of [undefined, null, "", 42, "error code"]) {
      for (const msg of [undefined, null, "", 42, "error message"]) {
        try {
          nativeTests.create_and_throw_error(code, msg, errorKind);
          console.log(
            `napi_create_${errorKind}(${code === null ? "nullptr" : code}, ${msg === null ? "nullptr" : msg}) did not make an error`,
          );
        } catch (e) {
          console.log(
            `create_and_throw_error(${errorKind}) threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`,
          );
        }
      }
    }
  }
};

module.exports = nativeTests;
