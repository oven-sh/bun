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
    5,
    "hello",
    // TODO(@190n) test null and undefined here on the napi fix branch
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
    "toString",
    "slice",
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

nativeTests.test_number_integer_conversions_from_js = () => {
  const i32 = { min: -(2 ** 31), max: 2 ** 31 - 1 };
  const u32Max = 2 ** 32 - 1;
  // this is not the actual max value for i64, but rather the highest double that is below the true max value
  const i64 = { min: -(2 ** 63), max: 2 ** 63 - 1024 };

  const i32Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    [-1.0, -1],
    // truncation
    [1.25, 1],
    [-1.25, -1],
    // limits
    [i32.min, i32.min],
    [i32.max, i32.max],
    // wrap around
    [i32.min - 1.0, i32.max],
    [i32.max + 1.0, i32.min],
    [i32.min - 2.0, i32.max - 1],
    [i32.max + 2.0, i32.min + 1],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of i32Cases) {
    const actualOutput = nativeTests.double_to_i32(input);
    console.log(`${input} as i32 => ${actualOutput}`);
    if (actualOutput !== expectedOutput) {
      console.error("wrong");
    }
  }

  const u32Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    // truncation
    [1.25, 1],
    [-1.25, u32Max],
    // limits
    [u32Max, u32Max],
    // wrap around
    [-1.0, u32Max],
    [u32Max + 1.0, 0],
    [-2.0, u32Max - 1],
    [u32Max + 2.0, 1],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of u32Cases) {
    const actualOutput = nativeTests.double_to_u32(input);
    console.log(`${input} as u32 => ${actualOutput}`);
    if (actualOutput !== expectedOutput) {
      console.error("wrong");
    }
  }

  const i64Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    [-1.0, -1],
    // truncation
    [1.25, 1],
    [-1.25, -1],
    // limits
    [i64.min, i64.min],
    [i64.max, i64.max],
    // clamp
    [i64.min - 4096.0, i64.min],
    // this one clamps to the exact max value of i64 (2**63 - 1), which is then rounded
    // to exactly 2**63 since that's the closest double that can be represented
    [i64.max + 4096.0, 2 ** 63],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of i64Cases) {
    const actualOutput = nativeTests.double_to_i64(input);
    console.log(
      `${typeof input == "number" ? input.toFixed(2) : input} as i64 => ${typeof actualOutput == "number" ? actualOutput.toFixed(2) : actualOutput}`,
    );
    if (actualOutput !== expectedOutput) {
      console.error("wrong");
    }
  }
};

nativeTests.test_create_array_with_length = () => {
  for (const size of [0, 5]) {
    const array = nativeTests.make_empty_array(size);
    console.log("length =", array.length);
    // should be 0 as array contains empty slots
    console.log("number of keys =", Object.keys(array).length);
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

nativeTests.test_type_tag = () => {
  const o1 = {};
  const o2 = {};

  nativeTests.add_tag(o1, 1, 2);

  try {
    // re-tag
    nativeTests.add_tag(o1, 1, 2);
  } catch (e) {
    console.log("tagging already-tagged object threw", e.toString());
  }

  console.log("tagging non-object succeeds: ", !nativeTests.try_add_tag(null, 0, 0));

  nativeTests.add_tag(o2, 3, 4);
  console.log("o1 matches o1:", nativeTests.check_tag(o1, 1, 2));
  console.log("o1 matches o2:", nativeTests.check_tag(o1, 3, 4));
  console.log("o2 matches o1:", nativeTests.check_tag(o2, 1, 2));
  console.log("o2 matches o2:", nativeTests.check_tag(o2, 3, 4));
};

module.exports = nativeTests;
