const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Worker, SHARE_ENV } = require("node:worker_threads");

async function check() {
  const cached = process.env;
  const cachedBun = globalThis.Bun?.env;
  const prefix = "BUN_SHARE_IDENTITY_";
  cached[prefix + "EXISTING"] = "before";
  const prototype = Object.create(Object.getPrototypeOf(cached));
  Object.defineProperty(prototype, "sharedInherited", {
    get() {
      return this === cached ? "owner" : "derived";
    },
  });
  Object.setPrototypeOf(cached, prototype);
  const read = () => [cached[prefix + "EXISTING"], cached[prefix + "NEW"]];
  for (let i = 0; i < 20000; i++) read();
  const worker = new Worker(
    `
    const { parentPort } = require("node:worker_threads");
    parentPort.on("message", key => {
      if (key === "mutate") {
        delete process.env.BUN_SHARE_IDENTITY_EXISTING;
        process.env.BUN_SHARE_IDENTITY_NEW = "worker";
        Object.defineProperty(process.env, "BUN_SHARE_IDENTITY_DEFINED", {
          value: 42, writable: true, enumerable: true, configurable: true,
        });
        parentPort.postMessage("mutated");
      } else {
        parentPort.postMessage({
          written: process.env.BUN_SHARE_IDENTITY_WRITTEN,
          defined: process.env.BUN_SHARE_IDENTITY_DEFINED,
          deleted: "BUN_SHARE_IDENTITY_NEW" in process.env,
        });
      }
    });
    parentPort.postMessage("ready");
  `,
    { eval: true, env: SHARE_ENV },
  );
  try {
    assert.ok(process.env === cached, "process.env identity changed");
    if (cachedBun) assert.ok(cachedBun === process.env, "Bun.env identity changed");
    assert.deepEqual(await once(worker, "message"), ["ready"]);
    assert.equal(Object.getPrototypeOf(cached), prototype);
    assert.equal(cached.sharedInherited, "owner");
    assert.equal("sharedInherited" in cached, true);
    for (let i = 0; i < 20000; i++) read();
    let message = once(worker, "message");
    worker.postMessage("mutate");
    assert.deepEqual(await message, ["mutated"]);
    assert.deepEqual(read(), [undefined, "worker"]);
    assert.equal(cached[prefix + "DEFINED"], "42");
    assert.deepEqual(
      Object.keys(cached)
        .filter(k => k.startsWith(prefix))
        .sort(),
      [prefix + "DEFINED", prefix + "NEW"],
    );
    assert.deepEqual(Object.getOwnPropertyDescriptor(cached, prefix + "NEW"), {
      value: "worker",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    assert.equal(Object.hasOwn(cached, prefix + "EXISTING"), false);
    assert.equal(prefix + "EXISTING" in cached, false);
    cached[prefix + "WRITTEN"] = 17;
    delete cached[prefix + "NEW"];
    Object.defineProperty(cached, prefix + "DEFINED", {
      value: false,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    assert.throws(() => Object.defineProperty(cached, prefix + "INVALID", { value: 1 }), {
      code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY",
    });
    const derived = Object.create(cached);
    derived[prefix + "WRITTEN"] = 99;
    assert.equal(derived[prefix + "WRITTEN"], 99);
    assert.equal(cached[prefix + "WRITTEN"], "17");
    assert.equal(derived.sharedInherited, "derived");
    const nextPrototype = { nextInherited: "next" };
    Object.setPrototypeOf(cached, nextPrototype);
    assert.equal(Object.getPrototypeOf(cached), nextPrototype);
    assert.equal(cached.nextInherited, "next");
    assert.equal("sharedInherited" in cached, false);
    message = once(worker, "message");
    worker.postMessage("read");
    assert.deepEqual(await message, [{ written: "17", defined: "false", deleted: false }]);
    const sibling = new Worker('process.env.BUN_SHARE_IDENTITY_WRITTEN = "sibling"', { eval: true, env: SHARE_ENV });
    assert.deepEqual(await once(sibling, "exit"), [0]);
    assert.equal(cached[prefix + "WRITTEN"], "sibling");
    assert.ok(process.env === cached, "process.env identity changed");
  } finally {
    await worker.terminate();
  }
}

if (process.argv[2]?.startsWith("coercion")) {
  (async () => {
    const env = process.env;
    let worker;
    const value = {
      toString() {
        worker = new Worker(
          `const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>parentPort.postMessage(process.env.BUN_SHARE_REENTRANT));`,
          { eval: true, env: SHARE_ENV },
        );
        return "coerced";
      },
    };
    if (process.argv[2] === "coercion-define") {
      Object.defineProperty(env, "BUN_SHARE_REENTRANT", {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else if (process.argv[2] === "coercion-descriptor") {
      Object.defineProperty(env, "BUN_SHARE_REENTRANT", {
        get value() {
          return value.toString();
        },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      env.BUN_SHARE_REENTRANT = value;
    }
    try {
      assert.ok(env === process.env, "identity");
      assert.equal(env.BUN_SHARE_REENTRANT, "coerced");
      const result = once(worker, "message");
      worker.postMessage("read");
      assert.deepEqual(await result, ["coerced"]);
      console.log("ok");
    } finally {
      await worker.terminate();
    }
  })();
} else if (process.argv[2] === "nested") {
  const worker = new Worker(
    `
    const assert = require("node:assert/strict");
    const { once } = require("node:events");
    const { Worker, SHARE_ENV } = require("node:worker_threads");
    (${check.toString()})().catch(error => { console.error(error); process.exitCode = 1; });
  `,
    { eval: true },
  );
  once(worker, "exit").then(([code]) => {
    assert.equal(code, 0);
    console.log("ok");
  });
} else {
  check().then(
    () => console.log("ok"),
    error => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
