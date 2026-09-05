const assert = require("node:assert");
const nativeTests = require("./build/Debug/napitests.node");
const secondAddon = require("./build/Debug/second_addon.node");
const asyncFinalizeAddon = require("./build/Debug/async_finalize_addon.node");
const testReferenceUnrefInFinalizer = require("./build/Debug/test_reference_unref_in_finalizer.node");
const testReferenceUnrefInFinalizerExperimental = require("./build/Debug/test_reference_unref_in_finalizer_experimental.node");

// Returns true once fn() is true, false if it still isn't after `max` GCs.
// Collection of any *particular* object is not guaranteed under JSC: a
// conservative stack/register scan can pin one address for the entire process,
// so callers that need a collection to happen should retry with a freshly
// allocated object (see test_remove_wrap_lifetime_with_strong_ref) rather
// than raising `max`.
async function tryGcUntil(fn, max = 100) {
  for (let i = 0; i < max; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 1);
    });
    collectGarbage();
    if (fn()) {
      return true;
    }
  }
  return false;
}

// Unlike the GC runner main.js passes in, this prints nothing, so tests whose
// number of GCs differs between the runtimes can use it.
function collectGarbage() {
  if (typeof Bun == "object") {
    Bun.gc(true);
  } else {
    // if this fails, you need to pass --expose-gc to node
    global.gc();
  }
}

async function gcUntil(fn, max = 100) {
  if (!(await tryGcUntil(fn, max))) {
    throw new Error(`Condition was not met after ${max} GC attempts`);
  }
}

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
  await gcUntil(() => nativeTests.was_finalize_called());
};

nativeTests.test_napi_async_work_execute_null_check = () => {
  const res = nativeTests.create_async_work_with_null_execute();
  if (res) {
    console.log("success!");
  } else {
    console.log("failure!");
  }
};

nativeTests.test_napi_async_work_complete_null_check = async () => {
  nativeTests.create_async_work_with_null_complete();
  await gcUntil(() => true);
};

nativeTests.test_napi_async_work_cancel = () => {
  // UV_THREADPOOL_SIZE is set to 2, create two blocking tasks,
  // then create another and cancel it, ensuring the work is not
  // scheduled before `napi_cancel_async_work` is called
  const res = nativeTests.test_cancel_async_work(result => {
    if (result) {
      console.log("success!");
    } else {
      console.log("failure!");
    }
  });

  if (!res) {
    console.log("failure!");
  }
};

nativeTests.test_promise_with_threadsafe_function = async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  // create_promise_with_threadsafe_function returns a promise that calls our function from another
  // thread (via napi_threadsafe_function) and resolves with its return value
  return await nativeTests.create_promise_with_threadsafe_function(() => 1234);
};

nativeTests.test_threadsafe_function_abort_then_last_release = async (_, queued = 0) => {
  // create (thread_count=1), acquire (=2), optionally queue items, abort (=1, closing)
  nativeTests.test_napi_threadsafe_function_abort_then_last_release(queued);
  // let the abort's scheduled dispatch run first
  await new Promise(resolve => setImmediate(resolve));
  // release the last reference of the already-closing tsfn (=0)
  nativeTests.test_napi_threadsafe_function_abort_then_last_release_drop();
  // wait for the finalizer (bounded poll, not a timed sleep)
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.test_napi_threadsafe_function_abort_then_last_release_finalized()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("finalized:", nativeTests.test_napi_threadsafe_function_abort_then_last_release_finalized());
  // the process must exit on its own after this returns; a leaked event-loop
  // keepalive would hang it forever
};

nativeTests.test_threadsafe_function_abort_full_queue = async () => {
  // abort a tsfn whose bounded queue is full, then call it without blocking:
  // napi_closing (16), not napi_queue_full (17), and it must still finalize
  console.log("call after abort:", nativeTests.test_napi_threadsafe_function_abort_full_queue());
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.test_napi_threadsafe_function_abort_full_queue_finalized()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("finalized:", nativeTests.test_napi_threadsafe_function_abort_full_queue_finalized());
};

nativeTests.test_threadsafe_function_finalizer_uses_handle = async () => {
  nativeTests.test_napi_threadsafe_function_finalizer_uses_handle();
  let report;
  for (let i = 0; i < 1000; i++) {
    report = nativeTests.test_napi_threadsafe_function_finalizer_uses_handle_report();
    if (report !== undefined) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("finalizer saw:", report);
};

nativeTests.test_threadsafe_function_abort_blocked_producers = async () => {
  // create (max_queue_size=1, thread_count=3), fill the queue, spawn two
  // producers that block on the condvar, then abort
  nativeTests.test_napi_threadsafe_function_abort_blocked_producers();
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.test_napi_threadsafe_function_abort_blocked_producers_finalized()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("finalized:", nativeTests.test_napi_threadsafe_function_abort_blocked_producers_finalized());
};

nativeTests.test_threadsafe_function_abort_with_outstanding_ref = async () => {
  // create (thread_count=2) with the second reference held by a thread that
  // makes no calls, then abort from this thread
  nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref();
  // the finalizer runs from the abort's dispatch on this thread, so a bounded
  // number of turns is enough; it must not wait for the other thread
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref_finalized()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log("finalized:", nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref_finalized());
  // the other thread releases once it has seen the finalizer run (or gives up
  // after 2s and says so); that is the one step here that depends on OS
  // scheduling, so wait for it by deadline, under the test runner's 5s
  const deadline = Date.now() + 3_000;
  while (
    nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref_release_status() === -1 &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  console.log(
    "released after finalize:",
    nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref_released_after_finalize(),
    "status:",
    nativeTests.test_napi_threadsafe_function_abort_with_outstanding_ref_release_status(),
  );
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
    null,
    undefined,
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
        console.log("threw", e.name);
      }
    }
  }
};

nativeTests.test_get_all_property_names_accessor = () => {
  // napi_key_filter values
  const napi_key_writable = 1;
  const napi_key_configurable = 1 << 2;
  // napi_key_collection_mode values
  const napi_key_include_prototypes = 0;
  const napi_key_own_only = 1;
  // napi_key_conversion values
  const napi_key_keep_numbers = 0;

  const filterStrings = keys => keys.filter(k => typeof k === "string").sort();

  // own_only: object with an own accessor property alongside data properties
  const ownAccessor = { data: 1 };
  Object.defineProperty(ownAccessor, "acc_rw", {
    get() {
      return 1;
    },
    set(v) {},
    configurable: true,
  });
  Object.defineProperty(ownAccessor, "acc_ro", {
    get() {
      return 1;
    },
    configurable: true,
  });
  Object.defineProperty(ownAccessor, "data_ro", { value: 2, writable: false, configurable: true });
  for (const filter of [napi_key_writable, napi_key_configurable, napi_key_writable | napi_key_configurable]) {
    const { status, keys } = nativeTests.get_all_property_names(
      ownAccessor,
      napi_key_own_only,
      filter,
      napi_key_keep_numbers,
    );
    console.log(`own_only filter=${filter}: status=${status}`, JSON.stringify(filterStrings(keys)));
  }

  // include_prototypes: a plain object reaches Object.prototype.__proto__ (an accessor)
  const plain = { a: 1 };
  for (const filter of [napi_key_writable, napi_key_configurable]) {
    const { status, keys } = nativeTests.get_all_property_names(
      plain,
      napi_key_include_prototypes,
      filter,
      napi_key_keep_numbers,
    );
    console.log(`include_prototypes filter=${filter}: status=${status}`, JSON.stringify(filterStrings(keys)));
  }
};

nativeTests.test_get_all_property_names_proxy_and_string_wrapper = () => {
  const napi_key_include_prototypes = 0;
  const napi_key_own_only = 1;
  const napi_key_writable = 1;
  const napi_key_enumerable = 1 << 1;
  const napi_key_configurable = 1 << 2;
  const napi_key_keep_numbers = 0;

  const apn = (obj, filter, mode = napi_key_own_only) =>
    nativeTests.get_all_property_names(obj, mode, filter, napi_key_keep_numbers);
  const show = (label, r) => console.log(label, "status=" + r.status, "keys=" + JSON.stringify(r.keys));
  const dropBuiltinProto = r => ({
    status: r.status,
    keys: r.keys
      .filter(k => typeof k !== "symbol" && !Object.prototype.hasOwnProperty(k) && !String.prototype.hasOwnProperty(k))
      .sort(),
  });

  // V8's FilterProxyKeys only applies ONLY_ENUMERABLE; writable/configurable
  // filters pass every proxy key regardless of the reported descriptor.
  const proxy = new Proxy(
    { a: 1 },
    {
      ownKeys: () => ["x", "y"],
      getOwnPropertyDescriptor: () => ({ value: 1, writable: false, enumerable: true, configurable: true }),
    },
  );
  for (const [name, f] of [
    ["writable", napi_key_writable],
    ["configurable", napi_key_configurable],
    ["enumerable", napi_key_enumerable],
  ]) {
    show(`proxy own_only ${name}:`, apn(proxy, f));
  }

  // A proxy with no traps still takes V8's proxy path: writable/configurable
  // do not filter even when the target's descriptors say otherwise.
  const target = {};
  Object.defineProperty(target, "ro", { value: 1, writable: false, enumerable: true, configurable: true });
  Object.defineProperty(target, "rw", { value: 2, writable: true, enumerable: true, configurable: true });
  show("proxy(no traps) writable:", apn(new Proxy(target, {}), napi_key_writable));

  // V8 adds a String wrapper's character indices without consulting the
  // attribute filter; only the ordinary own property `length` is filtered.
  const str = new String("ab");
  for (const [name, f] of [
    ["writable", napi_key_writable],
    ["configurable", napi_key_configurable],
    ["enumerable", napi_key_enumerable],
  ]) {
    show(`string own_only ${name}:`, apn(str, f));
  }
  class DerivedString extends String {}
  show("derived string writable:", apn(new DerivedString("xy"), napi_key_writable));

  // include_prototypes: the exemption applies at whatever prototype level owns
  // the key, matching V8's per-level KeyAccumulator dispatch. Built-in
  // prototype keys are dropped so engine ordering differences don't leak in.
  show(
    "proxy-proto include_prototypes writable:",
    dropBuiltinProto(apn(Object.create(proxy), napi_key_writable, napi_key_include_prototypes)),
  );
  show(
    "string-proto include_prototypes configurable:",
    dropBuiltinProto(apn(Object.create(str), napi_key_configurable, napi_key_include_prototypes)),
  );

  // Attribute filtering must still apply to ordinary objects.
  const plain = {};
  Object.defineProperty(plain, "w", { value: 1, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(plain, "ro", { value: 2, writable: false, enumerable: true, configurable: true });
  Object.defineProperty(plain, "nc", { value: 3, writable: true, enumerable: true, configurable: false });
  show("plain writable:", apn(plain, napi_key_writable));
  show("plain configurable:", apn(plain, napi_key_configurable));
  show("frozen writable:", apn(Object.freeze({ a: 1, b: 2 }), napi_key_writable));
};

nativeTests.test_get_all_property_names_throwing_proxy_traps = () => {
  const napi_key_include_prototypes = 0;
  const napi_key_own_only = 1;
  const napi_key_enumerable = 1 << 1;
  const napi_key_keep_numbers = 0;

  const show = (label, { status, keys, exception }) =>
    console.log(label, `status=${status}`, `keys=${JSON.stringify(keys)}`, `exception=${exception?.message}`);

  // ownKeys succeeds so key collection completes; the per-key descriptor walk
  // required by napi_key_enumerable is what invokes the throwing trap.
  const throwingDescriptor = new Proxy(
    {},
    {
      ownKeys: () => ["a"],
      getOwnPropertyDescriptor() {
        throw new Error("gopd trap");
      },
    },
  );
  show(
    "own_only gopd throws:",
    nativeTests.get_all_property_names(
      throwingDescriptor,
      napi_key_own_only,
      napi_key_enumerable,
      napi_key_keep_numbers,
    ),
  );
  show(
    "include_prototypes gopd throws on prototype:",
    nativeTests.get_all_property_names(
      Object.create(throwingDescriptor),
      napi_key_include_prototypes,
      napi_key_enumerable,
      napi_key_keep_numbers,
    ),
  );

};

nativeTests.test_get_all_property_names_get_prototype_throws_in_descriptor_walk = () => {
  const napi_key_include_prototypes = 0;
  const napi_key_enumerable = 1 << 1;
  const napi_key_keep_numbers = 0;

  // Key collection asks the proxy for its prototype once and must succeed so
  // the descriptor walk is reached; the walk asks again (the target does not
  // own "a") and that second call throws.
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => ["a"],
      getPrototypeOf() {
        if (calls++ > 0) throw new Error("getPrototypeOf trap");
        return null;
      },
    },
  );
  const { status, keys, exception } = nativeTests.get_all_property_names(
    Object.create(proxy),
    napi_key_include_prototypes,
    napi_key_enumerable,
    napi_key_keep_numbers,
  );
  console.log(`status=${status} keys=${JSON.stringify(keys)} exception=${exception?.message} calls=${calls}`);
};

nativeTests.test_set_property = () => {
  const objects = [
    {},
    { foo: "bar" },
    {
      set foo(value) {
        throw new Error(`set foo to ${value}`);
      },
    },
    {
      // getter but no setter
      get foo() {},
    },
    new Proxy(
      {},
      {
        set(_target, key, value) {
          throw new Error(`proxy set ${key} to ${value}`);
        },
      },
    ),
    null,
    undefined,
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
      console.log(objects.indexOf(object) + ", " + keys.indexOf(key));
      try {
        const ret = nativeTests.perform_set(object, key, 42);
        console.log("native function returned", ret);
        if (object[key] != 42) {
          throw new Error("setting property did not throw an error, but the property was not actually set");
        }
      } catch (e) {
        console.log("threw", e.name);
      }
    }
  }
};

nativeTests.test_define_properties = () => {
  const statusNames = [
    "napi_ok",
    "napi_invalid_arg",
    "napi_object_expected",
    "napi_string_expected",
    "napi_name_expected",
    "napi_function_expected",
    "napi_number_expected",
    "napi_boolean_expected",
    "napi_array_expected",
    "napi_generic_failure",
    "napi_pending_exception",
  ];
  const fmtStatus = s => statusNames[s] ?? String(s);
  const fmtDesc = d =>
    d === undefined
      ? "undefined"
      : JSON.stringify({
          value: d.value,
          get: typeof d.get,
          set: typeof d.set,
          writable: d.writable,
          enumerable: d.enumerable,
          configurable: d.configurable,
        });

  const run = (label, target, kind, name, inspectKey) => {
    const { status, pending } = nativeTests.define_properties(target, kind, name);
    let descText = "";
    if (inspectKey !== null) {
      descText = " desc=" + fmtDesc(Object.getOwnPropertyDescriptor(target, inspectKey));
    }
    console.log(`${label}: status=${fmtStatus(status)} pending=${pending}${descText}`);
  };

  for (const kind of ["value", "getter", "setter", "accessor", "method"]) {
    // frozen target: [[DefineOwnProperty]] must fail
    run(`frozen ${kind}`, Object.freeze({}), kind, undefined, "k");

    // proxy whose defineProperty trap records calls and forwards
    let trapCalls = 0;
    const proxTarget = {};
    const prox = new Proxy(proxTarget, {
      defineProperty(t, k, d) {
        trapCalls++;
        return Reflect.defineProperty(t, k, d);
      },
    });
    run(`proxy ${kind}`, prox, kind, undefined, null);
    console.log(
      `proxy ${kind}: trapCalls=${trapCalls} targetDesc=${fmtDesc(Object.getOwnPropertyDescriptor(proxTarget, "k"))}`,
    );

    // proxy with throwing trap
    const throwing = new Proxy(
      {},
      {
        defineProperty() {
          throw new TypeError("boom");
        },
      },
    );
    run(`throwing-proxy ${kind}`, throwing, kind, undefined, "k");

    // plain object: check descriptor shape (no synthetic getter for setter-only)
    run(`plain ${kind}`, {}, kind, undefined, "k");
  }

  // setter-only/getter-only over an existing accessor: a missing side must
  // leave that slot ABSENT in the descriptor (preserving the existing value),
  // not present-undefined.
  for (const kind of ["getter", "setter"]) {
    const existing = {};
    Object.defineProperty(existing, "k", {
      get: () => 1,
      set: () => {},
      configurable: true,
    });
    run(`redefine ${kind}`, existing, kind, undefined, "k");

    let trapDesc;
    const prox = new Proxy(
      {},
      {
        defineProperty(t, k, d) {
          trapDesc = { hasGet: "get" in d, hasSet: "set" in d };
          return Reflect.defineProperty(t, k, d);
        },
      },
    );
    nativeTests.define_properties(prox, kind, undefined);
    console.log(`proxy-shape ${kind}:`, JSON.stringify(trapDesc));
  }

  // name as a napi_value string
  run("name=string", {}, "value", "k", "k");
  // name as a napi_value symbol
  const sym = Symbol("s");
  run("name=symbol", {}, "value", sym, sym);
  // name as a napi_value number (not a valid property name)
  run("name=number", {}, "value", 5, "5");
  // name as a napi_value object (not a valid property name)
  run("name=object", {}, "value", { toString: () => "x" }, "x");
  // utf8name with invalid bytes: decoded with U+FFFD replacement
  run("utf8name=invalid", {}, "value", null, "\ufffd");

  // napi_define_class should also reject non-string/symbol property names
  for (const [label, name] of [
    ["string", "k"],
    ["number", 5],
  ]) {
    const { status, pending } = nativeTests.define_properties({}, "method", name, true);
    console.log(`define_class name=${label}: status=${fmtStatus(status)} pending=${pending}`);
  }
};

nativeTests.test_define_class_duplicate_properties = () => {
  const statusNames = [
    "napi_ok",
    "napi_invalid_arg",
    "napi_object_expected",
    "napi_string_expected",
    "napi_name_expected",
    "napi_function_expected",
    "napi_number_expected",
    "napi_boolean_expected",
    "napi_array_expected",
    "napi_generic_failure",
    "napi_pending_exception",
  ];
  const fmtStatus = status => statusNames[status] ?? String(status);

  for (const kind of ["value", "getter", "setter", "accessor", "method"]) {
    const result = nativeTests.define_properties({}, kind, undefined, true, true, false);
    let value = "";
    if (result.class && kind !== "setter") {
      const instance = new result.class();
      value = ` value=${kind === "method" ? instance.k() : instance.k}`;
    }
    console.log(`${kind}: status=${fmtStatus(result.status)} pending=${result.pending}${value}`);
  }

  const staticResult = nativeTests.define_properties({}, "method", undefined, true, true, true);
  console.log(`static method: status=${fmtStatus(staticResult.status)} pending=${staticResult.pending}`);
};

nativeTests.test_property_names_cache_poisoning = () => {
  // napi_key_include_prototypes = 0, napi_key_own_only = 1
  // napi_key_all_properties = 0, napi_key_skip_symbols = 16
  // napi_key_keep_numbers = 0
  const mkA = () => ({ a: 1, b: 2 });
  for (let i = 0; i < 20; i++) nativeTests.get_all_property_names(mkA(), 0, 0, 0);
  console.log("Reflect.ownKeys after get_all_property_names(include_prototypes):", Reflect.ownKeys(mkA()).join(","));
  console.log("Object.keys after get_all_property_names(include_prototypes):", Object.keys(mkA()).join(","));

  const proto = { pEnum: 9 };
  const mkB = () => {
    const o = Object.create(proto);
    o.w1 = 1;
    o.w2 = 2;
    return o;
  };
  for (let i = 0; i < 20; i++) nativeTests.get_property_names(mkB());
  console.log("Object.keys after get_property_names:", Object.keys(mkB()).join(","));
  console.log("Reflect.ownKeys after get_property_names:", Reflect.ownKeys(mkB()).join(","));

  const mkC = () => ({ c: 1, d: 2 });
  for (let i = 0; i < 20; i++) nativeTests.get_all_property_names(mkC(), 0, 16, 0);
  console.log("Object.getOwnPropertyNames after skip_symbols chain walk:", Object.getOwnPropertyNames(mkC()).join(","));

  // Own-only mode must still return only own keys and not poison anything.
  const mkD = () => ({ e: 1, f: 2 });
  for (let i = 0; i < 20; i++) nativeTests.get_all_property_names(mkD(), 1, 0, 0);
  console.log("Reflect.ownKeys after get_all_property_names(own_only):", Reflect.ownKeys(mkD()).join(","));

  // The napi result itself should still include inherited keys.
  const apnResult = nativeTests.get_all_property_names(mkA(), 0, 0, 0).keys;
  console.log("napi include_prototypes result has own a,b:", apnResult.includes("a") && apnResult.includes("b"));
  console.log("napi include_prototypes result has inherited toString:", apnResult.includes("toString"));
  const gpnResult = nativeTests.get_property_names(mkB());
  console.log("napi get_property_names result:", gpnResult.join(","));
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
    assert(actualOutput === expectedOutput);
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
    assert(actualOutput === expectedOutput);
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
    assert(actualOutput === expectedOutput);
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

nativeTests.test_this_value_of_bare_call_through_closure = () => {
  const { return_this } = nativeTests;
  // return_this is captured by keep, so the bare call below is resolved through the closure's
  // scope object, which JSC leaves in the call's this slot. A Node-API callback must still see
  // the sloppy-mode receiver (globalThis), never that scope object.
  function keep() {
    return return_this;
  }
  console.log("bare call through closure returned globalThis:", return_this() === globalThis);
  console.log("call(undefined) returned globalThis:", return_this.call(undefined) === globalThis);
  console.log("call(5) returned a Number object:", return_this.call(5) instanceof Number);
  const receiver = {};
  console.log("call(receiver) returned receiver:", return_this.call(receiver) === receiver);
  keep();
};

nativeTests.test_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  const instance = new NapiClass();
  console.log("static data =", NapiClass.getStaticData());
  console.log("static getter =", NapiClass.getter);
  console.log("foo =", instance.foo);
  console.log("data =", instance.getData());
};

nativeTests.test_subclass_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  class Subclass extends NapiClass {}
  const instance = new Subclass();
  console.log("subclass static data =", Subclass.getStaticData());
  console.log("subclass static getter =", Subclass.getter);
  console.log("subclass foo =", instance.foo);
  console.log("subclass data =", instance.getData());
};

nativeTests.test_napi_class_non_constructor_call = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  console.log("non-constructor call NapiClass() =", NapiClass());
  console.log("global foo set to ", typeof foo != "undefined" ? foo : undefined);
};

nativeTests.test_reflect_construct_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  let instance = Reflect.construct(NapiClass, [], Object);
  console.log("reflect constructed foo =", instance.foo);
  console.log("reflect constructed data =", instance.getData?.());
  class Foo {}
  instance = Reflect.construct(NapiClass, [], Foo);
  console.log("reflect constructed foo =", instance.foo);
  console.log("reflect constructed data =", instance.getData?.());
};

nativeTests.test_reflect_construct_no_prototype_crash = () => {
  // This test verifies the fix for jsDynamicCast being called on JSValue(0)
  // when a NAPI class constructor is called via Reflect.construct with a
  // newTarget that has no prototype property.

  const NapiClass = nativeTests.get_class_with_constructor();

  // Test 1: Constructor function with deleted prototype property
  // This case should work without crashing
  function ConstructorWithoutPrototype() {}
  delete ConstructorWithoutPrototype.prototype;

  try {
    const instance1 = Reflect.construct(NapiClass, [], ConstructorWithoutPrototype);
    console.log("constructor without prototype: success - no crash");
  } catch (e) {
    console.log("constructor without prototype error:", e.message);
  }

  // Test 2: Regular constructor (control test)
  // This should always work
  function NormalConstructor() {}

  try {
    const instance2 = Reflect.construct(NapiClass, [], NormalConstructor);
    console.log("normal constructor: success - no crash");
  } catch (e) {
    console.log("normal constructor error:", e.message);
  }

  // Test 3: Reflect.construct with Proxy newTarget (prototype returns undefined)
  function ProxyObject() {}

  const proxyTarget = new Proxy(ProxyObject, {
    get(target, prop) {
      if (prop === "prototype") {
        return undefined;
      }
      return target[prop];
    },
  });
  const instance3 = Reflect.construct(NapiClass, [], proxyTarget);
  console.log("✓ Success - no crash!");
};

nativeTests.test_napi_create_object_structured_clone = () => {
  // https://github.com/oven-sh/bun/issues/25658
  const obj = nativeTests.make_empty_object();
  assert.deepStrictEqual(obj, {});
  const cloned = structuredClone(obj);
  assert.deepStrictEqual(cloned, {});

  obj.foo = "bar";
  obj.nested = { x: 1 };
  const cloned2 = structuredClone(obj);
  assert.deepStrictEqual(cloned2, { foo: "bar", nested: { x: 1 } });
  assert(cloned2 !== obj);
  assert(cloned2.nested !== obj.nested);
  console.log("pass");
};

nativeTests.test_napi_wrap = () => {
  const values = [
    {},
    {}, // should be able to be wrapped differently than the distinct empty object above
    5,
    new Number(5),
    "abc",
    new String("abc"),
    null,
    Symbol("abc"),
    Symbol.for("abc"),
    new (nativeTests.get_class_with_constructor())(),
    new Proxy(
      {},
      Object.fromEntries(
        [
          "apply",
          "construct",
          "defineProperty",
          "deleteProperty",
          "get",
          "getOwnPropertyDescriptor",
          "getPrototypeOf",
          "has",
          "isExtensible",
          "ownKeys",
          "preventExtensions",
          "set",
          "setPrototypeOf",
        ].map(name => [
          name,
          () => {
            throw new Error("oops");
          },
        ]),
      ),
    ),
  ];
  const wrapSuccess = Array(values.length).fill(false);
  for (const [i, v] of values.entries()) {
    wrapSuccess[i] = nativeTests.try_wrap(v, i + 1);
    console.log(`${typeof v} did wrap: `, wrapSuccess[i]);
  }

  for (const [i, v] of values.entries()) {
    if (wrapSuccess[i]) {
      if (nativeTests.try_unwrap(v) !== i + 1) {
        throw new Error("could not unwrap same value");
      }
    } else {
      if (nativeTests.try_unwrap(v) !== undefined) {
        throw new Error("value unwraps without being successfully wrapped");
      }
    }
  }
};

nativeTests.test_napi_wrap_proxy = () => {
  const target = {};
  const proxy = new Proxy(target, {});
  assert(nativeTests.try_wrap(target, 5));
  assert(nativeTests.try_wrap(proxy, 6));
  console.log(nativeTests.try_unwrap(target), nativeTests.try_unwrap(proxy));
};

nativeTests.test_napi_wrap_cross_addon = () => {
  const wrapped = {};
  console.log("wrap succeeds:", nativeTests.try_wrap(wrapped, 42));
  console.log("unwrapped from other addon", secondAddon.try_unwrap(wrapped));
};

nativeTests.test_napi_wrap_prototype = () => {
  class Foo {}
  console.log("wrap prototype succeeds:", nativeTests.try_wrap(Foo.prototype, 42));
  // wrapping should not look at prototype chain
  console.log("unwrap instance:", nativeTests.try_unwrap(new Foo()));
};

nativeTests.test_napi_remove_wrap = () => {
  const targets = [{}, new (nativeTests.get_class_with_constructor())()];
  for (const t of targets) {
    const target = {};
    // fails
    assert(nativeTests.try_remove_wrap(target) === undefined);
    // wrap it
    assert(nativeTests.try_wrap(target, 5));
    // remove yields the wrapped value
    assert(nativeTests.try_remove_wrap(target) === 5);
    // neither remove nor unwrap work anymore
    assert(nativeTests.try_unwrap(target) === undefined);
    assert(nativeTests.try_remove_wrap(target) === undefined);
    // can re-wrap
    assert(nativeTests.try_wrap(target, 6));
    assert(nativeTests.try_unwrap(target) === 6);
  }
};

// parameters to create_wrap are: object, ask_for_ref, strong
const createWrapWithoutRef = o => nativeTests.create_wrap(o, false, false);
const createWrapWithWeakRef = o => nativeTests.create_wrap(o, true, false);
const createWrapWithStrongRef = o => nativeTests.create_wrap(o, true, true);

nativeTests.test_wrap_lifetime_without_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithoutRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
  object = undefined;
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_wrap_lifetime_with_weak_ref = async () => {
  // this looks the same as test_wrap_lifetime_without_ref because it is -- these cases should behave the same
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
  object = undefined;
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_wrap_lifetime_with_strong_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithStrongRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);

  object = undefined;
  // still referenced by native module, so these GCs must not collect it
  assert((await tryGcUntil(() => nativeTests.was_wrap_finalize_called(), 10)) === false);

  // can still get the value using the ref
  assert(nativeTests.get_wrap_data_from_ref() === 42);

  // now we free it
  nativeTests.unref_wrapped_value();
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_remove_wrap_lifetime_with_weak_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);

  assert(nativeTests.get_wrap_data(object) === 42);

  nativeTests.remove_wrap(object);
  assert(nativeTests.get_wrap_data(object) === undefined);
  assert(nativeTests.get_wrap_data_from_ref() === undefined);
  assert(nativeTests.get_object_from_ref() === object);

  object = undefined;

  // ref will stop working once the object is collected
  await gcUntil(() => nativeTests.is_wrapped_object_collected());
  assert(nativeTests.get_object_from_ref() === undefined);

  // finalizer shouldn't have been called
  assert(nativeTests.was_wrap_finalize_called() === false);
};

nativeTests.test_remove_wrap_lifetime_with_strong_ref = async () => {
  // A conservative stack/register scan can pin any one address for the whole
  // process, so "this object gets collected" is not guaranteed for a
  // particular object. The pin is address-specific: retry with a freshly
  // allocated object instead of running more GCs on the same one.
  const ATTEMPTS = 4;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let object = { foo: "bar" };
    assert(createWrapWithStrongRef(object) === object);

    assert(nativeTests.get_wrap_data(object) === 42);

    nativeTests.remove_wrap(object);
    assert(nativeTests.get_wrap_data(object) === undefined);
    assert(nativeTests.get_wrap_data_from_ref() === undefined);
    assert(nativeTests.get_object_from_ref() === object);

    object = undefined;

    // finalizer should not be called and object should not be freed
    const collectedWhileStrong = await tryGcUntil(
      () => nativeTests.was_wrap_finalize_called() || nativeTests.is_wrapped_object_collected(),
      10,
    );
    assert(collectedWhileStrong === false);

    // native code can still get the object
    assert(JSON.stringify(nativeTests.get_object_from_ref()) === `{"foo":"bar"}`);

    // now it can be collected. An abandoned ref from a failed attempt leaks,
    // which is fine in this fixture: its wrap was removed, so no finalizer
    // will touch the global state.
    nativeTests.unref_wrapped_value();
    if (await tryGcUntil(() => nativeTests.is_wrapped_object_collected())) {
      assert(nativeTests.get_object_from_ref() === undefined);
      return;
    }
  }
  throw new Error(`wrapped object was not collected in any of ${ATTEMPTS} attempts`);
};

nativeTests.test_ref_deleted_in_cleanup = () => {
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
};

nativeTests.test_ref_deleted_in_async_finalize = () => {
  asyncFinalizeAddon.create_ref();
};

nativeTests.test_reference_unref_in_finalizer = async gc => {
  // Create objects with finalizers that will call napi_reference_unref when GC'd
  let objects = testReferenceUnrefInFinalizer.test_reference_unref_in_finalizer();

  // Clear the reference to allow GC
  objects = null;

  // Force GC multiple times to ensure finalizers run
  if (gc) {
    gc();
    gc();
  }

  // Allocate large ArrayBuffers to trigger GC pressure
  const buffers = [];
  for (let i = 0; i < 100; i++) {
    buffers.push(new ArrayBuffer(10 * 1024 * 1024)); // 10MB each
    if (gc && i % 10 === 0) {
      gc();
    }
  }

  // Wait for async operations
  await new Promise(resolve => setTimeout(resolve, 50));

  // Force final GC
  if (gc) {
    gc();
    gc();
  }

  // Get stats to verify finalizers were called
  const stats = testReferenceUnrefInFinalizer.get_stats();
  console.log(`Finalizers called: ${stats.finalizersCalled}, Unrefs succeeded: ${stats.unrefsSucceeded}`);

  if (stats.finalizersCalled === 0) {
    throw new Error("No finalizers were called - test did not properly trigger GC");
  }

  if (stats.unrefsSucceeded === 0) {
    throw new Error("No napi_reference_unref calls succeeded");
  }

  console.log("SUCCESS: napi_reference_unref worked in finalizers without crashing");
};

nativeTests.test_reference_unref_in_finalizer_experimental = async gc => {
  // This test is expected to CRASH when the finalizer runs
  // The experimental NAPI module enforces GC checks and will abort the process
  console.log("WARNING: This test will crash the process - this is expected behavior!");

  // Create objects with finalizers that will call napi_reference_unref when GC'd
  let objects = testReferenceUnrefInFinalizerExperimental.test_reference_unref_in_finalizer_experimental();

  // Clear the reference to allow GC
  objects = null;

  // Force GC to trigger the finalizers - this should crash the process
  if (gc) {
    gc();
    gc();
  }

  // Allocate memory to ensure GC runs
  for (let i = 0; i < 5; i++) {
    new ArrayBuffer(10 * 1024 * 1024);
    if (gc) gc();
  }

  // If we get here, the test has FAILED - the process should have crashed
  console.log("ERROR: Process did not crash as expected!");
  console.log("ERROR: The GC check for experimental modules is NOT working!");
  throw new Error("Test FAILED: napi_reference_unref should have aborted for experimental module");
};

nativeTests.test_create_bigint_words = () => {
  console.log(nativeTests.create_weird_bigints());
};

nativeTests.test_get_all_property_names_own_only = () => {
  // napi_key_collection_mode
  const napi_key_own_only = 1;
  // napi_key_filter
  const napi_key_all_properties = 0;
  const napi_key_enumerable = 1 << 1;
  const napi_key_skip_strings = 1 << 3;
  const napi_key_skip_symbols = 1 << 4;
  // napi_key_conversion
  const napi_key_keep_numbers = 0;

  const sym = Symbol("s");
  const neSym = Symbol("nes");
  const o = { x: 1, [sym]: 2 };
  Object.defineProperty(o, "ne", { value: 3, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(o, neSym, { value: 4, enumerable: false, configurable: true, writable: true });

  const describe = keys => keys.map(k => (typeof k === "symbol" ? k.toString() : JSON.stringify(k)));

  for (const [label, filter] of [
    ["skip_symbols", napi_key_skip_symbols],
    ["skip_strings", napi_key_skip_strings],
    ["all_properties", napi_key_all_properties],
    ["skip_symbols|enumerable", napi_key_skip_symbols | napi_key_enumerable],
    ["skip_strings|enumerable", napi_key_skip_strings | napi_key_enumerable],
  ]) {
    const { status, keys } = nativeTests.get_all_property_names(o, napi_key_own_only, filter, napi_key_keep_numbers);
    console.log(`own_only + ${label}: status=${status} keys=[${describe(keys).join(", ")}]`);
  }
};

nativeTests.test_bigint_word_count = () => {
  // Test with a 2-word BigInt
  const bigint = 0x123456789abcdef0123456789abcdefn;
  const result = nativeTests.test_bigint_actual_word_count(bigint);

  console.log(`BigInt: ${bigint.toString(16)}`);
  console.log(`Queried word count: ${result.queriedWordCount}`);
  console.log(`Actual word count: ${result.actualWordCount}`);
  console.log(`Sign bit: ${result.signBit}`);

  // Both counts should be 2 for this BigInt
  if (result.queriedWordCount === 2 && result.actualWordCount === 2) {
    console.log("✅ PASS: Word count correctly returns 2");
  } else {
    console.log(
      `❌ FAIL: Expected word count 2, got queried=${result.queriedWordCount}, actual=${result.actualWordCount}`,
    );
  }
};

nativeTests.test_ref_unref_underflow = () => {
  // Test that napi_reference_unref properly handles refCount == 0
  const obj = { test: "value" };
  const result = nativeTests.test_reference_unref_underflow(obj);

  console.log(`First unref count: ${result.firstUnrefCount}`);
  console.log(`Second unref status: ${result.secondUnrefStatus}`);

  // First unref should succeed and return count of 0
  // Second unref should fail with napi_generic_failure (status = 1)
  if (result.firstUnrefCount === 0 && result.secondUnrefStatus === 1) {
    console.log("✅ PASS: Reference unref correctly prevents underflow");
  } else {
    console.log(
      `❌ FAIL: Expected firstUnrefCount=0, secondUnrefStatus=1, got ${result.firstUnrefCount}, ${result.secondUnrefStatus}`,
    );
  }
};

nativeTests.test_napi_instanceof = () => {
  function dump(label, r) {
    const errName = r.exception && r.exception.constructor ? r.exception.constructor.name : undefined;
    const errCode = r.exception ? r.exception.code : undefined;
    console.log(
      `${label}: status=${r.status} result=${r.result} pending=${r.pending} errName=${errName} errCode=${errCode}`,
    );
  }

  class Base {}
  const instance = new Base();
  dump("class/instance", nativeTests.perform_instanceof(instance, Base));
  dump("class/plain-obj", nativeTests.perform_instanceof({}, Base));

  const arrow = () => 1;
  Object.defineProperty(arrow, Symbol.hasInstance, { value: () => true });
  dump("arrow+hasInstance", nativeTests.perform_instanceof({}, arrow));

  const bound = function () {}.bind(null);
  Object.defineProperty(bound, Symbol.hasInstance, { value: () => true });
  dump("bound+hasInstance", nativeTests.perform_instanceof({}, bound));

  const bareArrow = () => 1;
  dump("bare-arrow ctor", nativeTests.perform_instanceof({}, bareArrow));

  class Throws {
    static [Symbol.hasInstance]() {
      throw new RangeError("boom");
    }
  }
  dump("hasInstance throws", nativeTests.perform_instanceof({}, Throws));

  const proxy = new Proxy(Base, {
    get(t, k) {
      if (k === Symbol.hasInstance) throw new RangeError("proxy");
      return Reflect.get(t, k);
    },
  });
  dump("proxy get throws", nativeTests.perform_instanceof({}, proxy));

  dump("number ctor", nativeTests.perform_instanceof({}, 5));
  dump("plain-obj ctor", nativeTests.perform_instanceof({}, { x: 1 }));
  dump("null ctor", nativeTests.perform_instanceof({}, null));
  dump("undefined ctor", nativeTests.perform_instanceof({}, undefined));
};

// V8's Object::GetPrototype (what napi_get_prototype wraps in Node) returns null
// for a Proxy without running its getPrototypeOf trap, so the proxy lines below
// all read "result=null" with nothing pending, whatever the trap would do.
// result= is "untouched" if *result was not written and "null handle" if a NULL
// napi_value was written (see perform_get_prototype in js_test_helpers.cpp).
nativeTests.test_napi_get_prototype_proxy = () => {
  const trapError = new RangeError("from getPrototypeOf trap");
  let trapCalls = 0;
  const chainProxy = new Proxy({}, {});
  const names = [
    [Object.prototype, "Object.prototype"],
    [Array.prototype, "Array.prototype"],
    [Function.prototype, "Function.prototype"],
    [chainProxy, "the proxy"],
  ];

  function dump(label, object) {
    const r = nativeTests.perform_get_prototype(object);
    const named = names.find(([value]) => value === r.result);
    const result = typeof r.result === "string" ? r.result : named ? named[1] : String(r.result);
    const exception =
      r.exception === undefined
        ? "none"
        : r.exception === trapError
          ? "the trap's error"
          : r.exception instanceof TypeError
            ? "TypeError"
            : String(r.exception);
    console.log(`${label}: status=${r.status} pending=${r.pending} result=${result} exception=${exception}`);
  }

  dump("plain object", {});
  dump("null prototype", Object.create(null));

  dump("proxy without traps", new Proxy([], {}));
  dump("callable proxy", new Proxy(function () {}, {}));
  dump(
    "trap returns Array.prototype",
    new Proxy(
      {},
      {
        getPrototypeOf() {
          trapCalls++;
          return Array.prototype;
        },
      },
    ),
  );
  console.log(`getPrototypeOf trap calls: ${trapCalls}`);
  dump(
    "trap throws",
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw trapError;
        },
      },
    ),
  );
  dump(
    "trap returns a number",
    new Proxy(
      {},
      {
        getPrototypeOf() {
          return 42;
        },
      },
    ),
  );
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  dump("revoked proxy", revocable.proxy);

  // Only the object itself is special-cased; a proxy further up the chain is
  // returned like any other prototype.
  dump("object whose prototype is a proxy", Object.create(chainProxy));

  dump("plain object again", {});
};

nativeTests.test_get_value_string = () => {
  function to16Bit(string) {
    if (typeof Bun != "object") return string;
    const jsc = require("bun:jsc");
    const codeUnits = new DataView(new ArrayBuffer(2 * string.length));
    for (let i = 0; i < string.length; i++) {
      codeUnits.setUint16(2 * i, string.charCodeAt(i), true);
    }
    const decoder = new TextDecoder("utf-16le");
    const string16Bit = decoder.decode(codeUnits);
    // make sure we succeeded in making a UTF-16 string
    assert(jsc.jscDescribe(string16Bit).includes("8Bit:(0)"));
    return string16Bit;
  }
  function assert8Bit(string) {
    if (typeof Bun != "object") return string;
    const jsc = require("bun:jsc");
    // make sure we succeeded in making a Latin-1 string
    assert(jsc.jscDescribe(string).includes("8Bit:(1)"));
    return string;
  }
  // test all of our get_value_string_XXX functions on a variety of inputs
  for (const [string, description] of [
    ["hello", "simple latin-1"],
    [to16Bit("hello"), "16-bit encoded with only BMP characters"],
    [assert8Bit("café"), "8-bit with non-ascii characters"],
    [to16Bit("café"), "16-bit with non-ascii but latin-1 characters"],
    ["你好小圆面包", "16-bit, all BMP, all outside latin-1"],
    ["🐱🏳️‍⚧️", "16-bit with many surrogate pairs"],
    // TODO(@190n) handle these correctly
    // ["\ud801", "unpaired high surrogate"],
    // ["\udc02", "unpaired low surrogate"],
  ]) {
    console.log(`test napi_get_value_string on ${string} (${description})`);
    for (const encoding of ["latin1", "utf8", "utf16"]) {
      console.log(encoding);
      const fn = nativeTests[`test_get_value_string_${encoding}`];
      fn(string);
    }
  }
};

nativeTests.test_constructor_order = () => {
  require("./build/Debug/constructor_order_addon.node");
};

// Cleanup hook tests
nativeTests.test_cleanup_hook_order = () => {
  const addon = require("./build/Debug/test_cleanup_hook_order.node");
  addon.test();
};

// Node tears an addon's env down (its cleanup hooks, then the finalizers of
// whatever it still has alive) only when the main thread's event loop runs dry.
// process.exit() skips all of it, so only the two lines printed by test() are
// expected here: no "hookN executed" lines and no "finalize order" line.
nativeTests.test_env_teardown_skipped_by_process_exit = () => {
  const hooks = require("./build/Debug/test_cleanup_hook_order.node");
  const wraps = require("./build/Debug/test_wrap_cleanup_order.node");
  hooks.test();
  globalThis.keep = wraps.createParentAndChildren(1);
  process.exit(0);
};

nativeTests.test_cleanup_hook_remove_nonexistent = () => {
  const addon = require("./build/Debug/test_cleanup_hook_remove_nonexistent.node");
  addon.test();
};

nativeTests.test_async_cleanup_hook_remove_nonexistent = () => {
  const addon = require("./build/Debug/test_async_cleanup_hook_remove_nonexistent.node");
  addon.test();
};

nativeTests.test_async_cleanup_hook_tsfn_release = () => {
  const addon = require("./build/Debug/test_async_cleanup_hook_tsfn_release.node");
  addon.start();
};

nativeTests.test_cleanup_hook_duplicates = () => {
  const addon = require("./build/Debug/test_cleanup_hook_duplicates.node");
  addon.test();
};

nativeTests.test_cleanup_hook_mixed_order = () => {
  const addon = require("./build/Debug/test_cleanup_hook_mixed_order.node");
  addon.test();
};

nativeTests.test_cleanup_hook_modification_during_iteration = () => {
  const addon = require("./build/Debug/test_cleanup_hook_modification_during_iteration.node");
  addon.test();
};

nativeTests.test_create_reference_primitive_by_version = () => {
  const v10 = require("./build/Debug/test_create_reference_primitive_v10.node");
  const v8 = require("./build/Debug/test_create_reference_primitive_v8.node");
  const cases = [
    ["undefined", undefined],
    ["null", null],
    ["boolean", true],
    ["number", 1.5],
    ["string", "s"],
    ["bigint", 7n],
    ["symbol", Symbol("sym")],
    ["registered symbol", Symbol.for("test_create_reference_primitive")],
    ["object", { a: 1 }],
    ["function", () => 0],
  ];
  for (const [declared, addon] of [
    [10, v10],
    [8, v8],
  ]) {
    for (const [name, value] of cases) {
      const { status, roundTrip, heldAtZero, reref, declared: d } = addon.create_ref(value);
      let line = `declared=${declared} header=${d} ${name}: status=${status}`;
      if (status === 0) line += ` roundTrip=${roundTrip} heldAtZero=${heldAtZero} reref=${reref}`;
      console.log(line);
    }
  }
};

// Test for napi_typeof with boxed primitive objects (String, Number, Boolean)
// See: https://github.com/oven-sh/bun/issues/25351
nativeTests.test_napi_typeof_boxed_primitives = () => {
  // napi_valuetype enum values (from node_api_types.h):
  // napi_undefined = 0, napi_null = 1, napi_boolean = 2, napi_number = 3,
  // napi_string = 4, napi_symbol = 5, napi_object = 6, napi_function = 7,
  // napi_external = 8, napi_bigint = 9

  const napi_string = 4;
  const napi_object = 6;

  // Primitive string should be napi_string
  const primitiveStringType = nativeTests.napi_get_typeof("hello");
  assert.strictEqual(
    primitiveStringType,
    napi_string,
    `primitive string should be napi_string (${napi_string}), got ${primitiveStringType}`,
  );
  console.log("PASS: primitive string returns napi_string");

  // String object should be napi_object
  const stringObjectType = nativeTests.napi_get_typeof(new String("hello"));
  assert.strictEqual(
    stringObjectType,
    napi_object,
    `String object should be napi_object (${napi_object}), got ${stringObjectType}`,
  );
  console.log("PASS: String object returns napi_object");

  // Number object should be napi_object
  const numberObjectType = nativeTests.napi_get_typeof(new Number(42));
  assert.strictEqual(
    numberObjectType,
    napi_object,
    `Number object should be napi_object (${napi_object}), got ${numberObjectType}`,
  );
  console.log("PASS: Number object returns napi_object");

  // Boolean object should be napi_object
  const booleanObjectType = nativeTests.napi_get_typeof(new Boolean(true));
  assert.strictEqual(
    booleanObjectType,
    napi_object,
    `Boolean object should be napi_object (${napi_object}), got ${booleanObjectType}`,
  );
  console.log("PASS: Boolean object returns napi_object");

  console.log("All boxed primitive tests passed!");
};

// https://github.com/oven-sh/bun/issues/25933
// Test that napi_typeof returns napi_function for callbacks wrapped in
// AsyncContextFrame (which happens inside AsyncLocalStorage.run()).
nativeTests.test_napi_typeof_async_context_frame = async () => {
  const { AsyncLocalStorage } = require("node:async_hooks");
  const als = new AsyncLocalStorage();

  await als.run({ key: "value" }, () => {
    return new Promise(resolve => {
      // Pass a callback to the native addon. Because we're inside
      // AsyncLocalStorage.run(), Bun wraps it in AsyncContextFrame.
      // The native call_js_cb will call napi_typeof on the received
      // js_callback and print the result.
      nativeTests.test_issue_25933(() => {});
      // The threadsafe function callback fires asynchronously.
      setTimeout(resolve, 50);
    });
  });
};

// Test that napi_make_callback works when the func is an AsyncContextFrame
// (received by a threadsafe function's call_js_cb inside AsyncLocalStorage.run()).
nativeTests.test_make_callback_with_async_context = async () => {
  const { AsyncLocalStorage } = require("node:async_hooks");
  const als = new AsyncLocalStorage();

  await als.run({ key: "value" }, () => {
    return new Promise(resolve => {
      nativeTests.test_napi_make_callback_async_context_frame(() => {});
      setTimeout(resolve, 50);
    });
  });
};

// Test that napi_create_threadsafe_function with call_js_cb=NULL accepts an
// AsyncContextFrame as the func (received from another threadsafe function's call_js_cb).
nativeTests.test_create_tsfn_with_async_context = async () => {
  const { AsyncLocalStorage } = require("node:async_hooks");
  const als = new AsyncLocalStorage();

  await als.run({ key: "value" }, () => {
    return new Promise(resolve => {
      nativeTests.test_napi_create_tsfn_async_context_frame(() => {});
      setTimeout(resolve, 100);
    });
  });
};

// An addon's own threads outlive the worker that created the threadsafe
// functions (next-swc's tokio pool does this): the last call and the last
// release land after the worker's VM, and the event loop they point at, are
// gone.
async function runOrphanWorker(workerData) {
  const { Worker } = require("node:worker_threads");
  const path = require("node:path");
  const worker = new Worker(path.join(__dirname, "tsfn-orphan-worker.js"), { workerData });
  const code = await new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("exit", resolve);
  });
  return code;
}

nativeTests.test_threadsafe_function_orphaned_by_worker = async () => {
  console.log("worker exited with", await runOrphanWorker());
  console.log(nativeTests.use_orphaned_threadsafe_functions());
};

// A finalizer that runs during a worker's env cleanup and registers another
// finalizer (an external buffer's): the late one runs in that same cleanup.
nativeTests.test_finalizer_registered_during_env_cleanup = async () => {
  console.log("worker exited with", await runOrphanWorker({ lateFinalizer: true }));
  console.log("late=" + nativeTests.late_finalizer_run_count());
};

// The ArrayBuffer behind napi_create_external_arraybuffer / napi_create_external_buffer is
// untransferable (node: Buffer::New with a free callback marks it so): its finalizer belongs
// to the env that created it, and that env's teardown frees the bytes. Every transfer entry
// point refuses it with a DataCloneError and leaves it, the rest of the transfer list, and the
// finalizer untouched; cloning without a transfer still copies it.
nativeTests.test_external_buffer_untransferable = () => {
  const { MessageChannel, Worker, isMarkedAsUntransferable } = require("node:worker_threads");
  const attempt = (label, transfer) => {
    try {
      transfer();
      console.log(`${label}: transferred`);
    } catch (e) {
      console.log(`${label}: ${e.name} code=${e.code}`);
    }
  };
  // Everything created here stays alive until the stats are printed, so the
  // only way a finalizer can run is a transfer attempt running it.
  const keepAlive = [];
  for (const kind of ["arraybuffer", "buffer"]) {
    const created =
      kind === "arraybuffer"
        ? nativeTests.create_external_arraybuffer_for_transfer(8)
        : nativeTests.create_external_buffer_for_transfer(8);
    keepAlive.push(created);
    const arrayBuffer = kind === "arraybuffer" ? created : created.buffer;
    console.log(
      `${kind}: isMarkedAsUntransferable(created)=${isMarkedAsUntransferable(created)}`,
      `isMarkedAsUntransferable(arrayBuffer)=${isMarkedAsUntransferable(arrayBuffer)}`,
      `ownKeys=${Reflect.ownKeys(arrayBuffer).length}`,
    );

    attempt(`${kind}: structuredClone`, () => structuredClone(arrayBuffer, { transfer: [arrayBuffer] }));
    const { port1, port2 } = new MessageChannel();
    attempt(`${kind}: MessagePort.postMessage`, () => port1.postMessage(arrayBuffer, [arrayBuffer]));
    port1.close();
    port2.close();
    attempt(
      `${kind}: new Worker transferList`,
      () => new Worker("", { eval: true, workerData: arrayBuffer, transferList: [arrayBuffer] }),
    );
    const plain = new ArrayBuffer(2);
    attempt(`${kind}: structuredClone after a plain ArrayBuffer`, () =>
      structuredClone([plain, arrayBuffer], { transfer: [plain, arrayBuffer] }),
    );
    console.log(`${kind}: byteLength=${arrayBuffer.byteLength} plain.byteLength=${plain.byteLength}`);

    const copy = structuredClone(arrayBuffer);
    console.log(`${kind}: copy=[${new Uint8Array(copy).join(",")}] byteLength=${arrayBuffer.byteLength}`);
  }
  // Length 0 is a separate path inside napi_create_external_buffer; it is marked all the same.
  // (Only the mark and the transfer are compared: bun detaches this buffer, node does not.)
  for (const kind of ["arraybuffer", "buffer"]) {
    const created =
      kind === "arraybuffer"
        ? nativeTests.create_external_arraybuffer_for_transfer(0)
        : nativeTests.create_external_buffer_for_transfer(0);
    keepAlive.push(created);
    const arrayBuffer = kind === "arraybuffer" ? created : created.buffer;
    console.log(`empty ${kind}: isMarkedAsUntransferable(arrayBuffer)=${isMarkedAsUntransferable(arrayBuffer)}`);
    attempt(`empty ${kind}: structuredClone`, () => structuredClone(arrayBuffer, { transfer: [arrayBuffer] }));
  }
  console.log("stats:", JSON.stringify(nativeTests.external_for_transfer_stats()));
};

// A worker creates the buffers and exits: the parent can only ever have copies,
// and the worker's env teardown finalizes both on the thread that created them.
nativeTests.test_external_buffer_worker_exit = async () => {
  const { Worker } = require("node:worker_threads");
  const path = require("node:path");
  const worker = new Worker(path.join(__dirname, "external-buffer-worker.js"));
  const messages = [];
  const exitCode = await new Promise((resolve, reject) => {
    worker.on("message", message => messages.push(message));
    worker.on("error", reject);
    worker.on("exit", resolve);
  });
  console.log("worker exited with", exitCode);
  console.log("messages:", JSON.stringify(messages));
  console.log("stats after exit:", JSON.stringify(nativeTests.external_for_transfer_stats()));
};

// Bun-only: an orphaned threadsafe function is freed by whichever thread drops
// its last reference, including a call that reports napi_closing. Every
// iteration must end with as many live threadsafe functions as it started with.
nativeTests.test_threadsafe_function_orphan_leak = async () => {
  const { napiThreadsafeFunctionLiveCount } = require("bun:internal-for-testing");
  const before = napiThreadsafeFunctionLiveCount();
  for (let i = 0; i < 5; i++) {
    const code = await runOrphanWorker({ leak: 5 });
    if (code !== 0) throw new Error(`worker exited with ${code}`);
    const orphaned = napiThreadsafeFunctionLiveCount() - before;
    const closing = nativeTests.call_leaked_threadsafe_functions();
    console.log(`orphaned=${orphaned} closing=${closing} leaked=${napiThreadsafeFunctionLiveCount() - before}`);
  }
};

// Items still queued on a threadsafe function when the process exits are
// dropped: node's process.exit() never gets back to the function, and an
// addon's call_js usually cannot take a null env.
nativeTests.test_threadsafe_function_queued_items_at_process_exit = () => {
  nativeTests.queue_threadsafe_function_items(() => {}, 3, /* print_finalize */ false);
  require("node:fs").writeSync(1, "exiting with 3 items queued\n");
  process.exit(0);
};

// The same from inside the function's own callback: the items behind the one
// that is running must not be delivered into the callback's frame.
nativeTests.test_threadsafe_function_process_exit_inside_callback = () => {
  nativeTests.queue_threadsafe_function_items(() => process.exit(0), 3, /* print_finalize */ false);
  // Returning a pending promise keeps main.js quiet; the first item's callback
  // exits the process.
  return new Promise(() => {});
};

// A worker that exits (process.exit()) or is terminated with items queued: the
// addon gets each item through call_js with the live env (calling into JS is
// refused), then the finalizer, as when node's env cleanup turns the loop.
async function runQueuedItemsWorker(how) {
  const { Worker } = require("node:worker_threads");
  const path = require("node:path");
  const worker = new Worker(path.join(__dirname, "tsfn-queued-items-worker.js"), { workerData: { how } });
  const code = await new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("exit", resolve);
    if (how === "terminate") {
      worker.on("message", () => worker.terminate());
    }
  });
  console.log("worker exited with", code);
}

nativeTests.test_threadsafe_function_queued_items_at_worker_exit = () => runQueuedItemsWorker("exit");
nativeTests.test_threadsafe_function_queued_items_at_worker_terminate = () => runQueuedItemsWorker("terminate");

// napi_tsfn_abort with items queued: none of them runs; each goes back to
// call_js with a null env and js_callback so the addon can free it, and then
// the function finalizes.
nativeTests.test_threadsafe_function_abort_hands_queued_items_back = async () => {
  // writeSync: these interleave with the addon's printf lines, so they must
  // reach stdout synchronously.
  const { writeSync } = require("node:fs");
  nativeTests.queue_threadsafe_function_items(
    () => writeSync(1, "js callback ran after abort\n"),
    3,
    /* print_finalize */ true,
  );
  writeSync(1, `abort: ${nativeTests.abort_threadsafe_function_with_queued_items()}\n`);
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.threadsafe_function_with_queued_items_finalized()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  writeSync(1, `finalized: ${nativeTests.threadsafe_function_with_queued_items_finalized()}\n`);
};

// When napi_create_threadsafe_function is given no JS func, the call_js
// callback receives a null js_callback (addons test `if (js_callback != NULL)`).
nativeTests.test_tsfn_null_js_callback_driver = async () => {
  nativeTests.test_tsfn_null_js_callback();
  for (let i = 0; i < 1000; i++) {
    if (nativeTests.test_tsfn_null_js_callback_ran()) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  nativeTests.test_tsfn_null_js_callback_result();
};

// napi_reference_ref on a reference whose referent has been collected must
// return 0 (and leave the count at 0) instead of incrementing.
nativeTests.test_reference_ref_after_collect_driver = async gc => {
  const ext = nativeTests.test_create_weak_ref_for_gc();
  await gcUntil(() => nativeTests.test_weak_ref_is_collected(gc, ext));
  nativeTests.test_reference_ref_after_collect(gc, ext);
};

const tickImmediate = () => new Promise(resolve => setImmediate(resolve));

// The test_delete_ref_cancels_finalizer addon declares a released Node-API
// version, so its finalizers run from the event loop after the GC. Deleting
// the reference in between (what an addon does when it frees the native
// object itself) must cancel them. Both drivers retry with fresh objects when a
// conservative scan keeps an object alive, and print only what does not depend
// on how many attempts that took.
nativeTests.test_delete_ref_after_collect = async () => {
  const addon = require("./build/Debug/test_delete_ref_cancels_finalizer.node");
  for (const [name, useAddFinalizer] of [
    ["napi_wrap", false],
    ["napi_add_finalizer", true],
  ]) {
    let collected = false;
    for (let attempt = 0; attempt < 100 && !collected; attempt++) {
      addon.makeSolo(useAddFinalizer);
      collectGarbage();
      collected = addon.isSoloCollected();
      // In the same turn as the GC that queued the finalizer.
      addon.deleteSolo();
      if (!collected) await new Promise(resolve => setTimeout(resolve, 1));
    }
    // A queued finalizer would run on the next turn.
    for (let i = 0; i < 5; i++) await tickImmediate();
    console.log(
      `${name}: collected before delete: ${collected}, finalized after delete: ${addon.soloFinalizedAfterDelete()}`,
    );
  }
};

nativeTests.test_delete_ref_after_collect_parent_and_children = async () => {
  const addon = require("./build/Debug/test_delete_ref_cancels_finalizer.node");
  for (const parentFirst of [true, false]) {
    let collected = false;
    for (let attempt = 0; attempt < 100 && !collected; attempt++) {
      addon.makePair(parentFirst);
      collectGarbage();
      collected = addon.isParentCollected();
      if (!collected) {
        addon.discardPair();
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    for (let i = 0; i < 1000 && !addon.isParentFinalized(); i++) await tickImmediate();
    // Give the children's finalizers, queued by the same GC, their turn too.
    for (let i = 0; i < 5; i++) await tickImmediate();
    console.log(
      `parent created ${parentFirst ? "before" : "after"} children: parent collected: ${collected}, parent finalized: ${addon.isParentFinalized()}, children finalized after delete: ${addon.childFinalizedAfterDelete()}`,
    );
  }
};

// Microtasks queued by one threadsafe-function callback must be drained before
// the next callback in the same dispatch, and not before the first one.
nativeTests.test_threadsafe_function_microtask_order = async () => {
  let n = 0;
  nativeTests.test_napi_threadsafe_function_microtask_order(null, () => {
    const i = ++n;
    console.log("callback", i);
    Promise.resolve().then(() => console.log("microtask", i));
  });
  for (let i = 0; i < 1000 && n < 3; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

// A script that only ever calls the ungated napi functions (ungated-calls-
// spin-worker.js has the worker version) still has to be stoppable when the
// stop is requested while one of those calls is running. Several rounds, since
// whether it lands inside a call or in the loop itself is down to timing.
nativeTests.test_ungated_calls_vm_timeout = () => {
  const vm = require("node:vm");
  const spin = nativeTests.make_ungated_calls_spinner();
  for (let i = 0; i < 5; i++) {
    try {
      vm.runInNewContext("for (;;) spin(bigint, string);", { spin, bigint: -7n, string: "ungated" }, { timeout: 20 });
      console.log("returned");
    } catch (e) {
      console.log(e.code);
    }
  }
};

nativeTests.test_ungated_calls_worker_terminate = async () => {
  const { Worker } = require("node:worker_threads");
  const path = require("node:path");
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(path.join(__dirname, "ungated-calls-spin-worker.js"));
    await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    console.log("terminate() resolved with", await worker.terminate());
  }
};

// See ungated_calls_through_timeout in standalone_tests.cpp: 600ms of ungated
// calls under a 150ms timeout. The timeout is wall-clock from the start of the
// run, so it must comfortably cover reaching the addon on the slowest lane.
nativeTests.test_ungated_calls_through_vm_timeout = () => {
  const vm = require("node:vm");
  try {
    vm.runInNewContext("f(600)", { f: nativeTests.ungated_calls_through_timeout }, { timeout: 150 });
    console.log("returned");
  } catch (e) {
    console.log(e.code);
  }
};

nativeTests.test_threadsafe_function_call_js_throws = async () => {
  // main.js exits on the first uncaught exception; this test wants all three.
  process.removeAllListeners("uncaughtException");
  let seen = 0;
  const { promise, resolve } = Promise.withResolvers();
  process.on("uncaughtException", function handler(err) {
    seen++;
    console.log("uncaughtException", seen, err.message);
    Promise.resolve().then(() => console.log("microtask", seen));
    if (seen === 3) {
      process.removeListener("uncaughtException", handler);
      resolve();
    }
  });
  nativeTests.test_napi_threadsafe_function_call_js_throws();
  await promise;
  await new Promise(r => setImmediate(r));
  console.log("done", seen);
};

module.exports = nativeTests;
