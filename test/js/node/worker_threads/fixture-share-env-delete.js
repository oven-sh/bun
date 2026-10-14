const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Worker, SHARE_ENV } = require("node:worker_threads");

async function check() {
  const cached = process.env;
  const cachedBun = globalThis.Bun?.env;
  const worker = new Worker(
    `const { parentPort } = require("node:worker_threads");
     parentPort.on("message", () => parentPort.postMessage({
       first: process.env.BUN_SHARE_DELETE_A,
       second: process.env.BUN_SHARE_DELETE_B,
     }));
     parentPort.postMessage("ready");`,
    { eval: true, env: SHARE_ENV },
  );
  try {
    assert.deepEqual(await once(worker, "message"), ["ready"]);
    assert.equal(process.env, cached);
    if (cachedBun) assert.equal(cachedBun, cached);
    const read = env => ({ first: env.BUN_SHARE_DELETE_A, second: env.BUN_SHARE_DELETE_B });
    const remove =
      process.argv[2] === "reflect" ? key => Reflect.deleteProperty(cached, key) : key => delete cached[key];
    // Warm absent-key deletion before shared writes, so a cached no-op cannot pass.
    for (let i = 0; i < 20000; i++) {
      read(cached);
      remove("BUN_SHARE_DELETE_A");
      remove("BUN_SHARE_DELETE_B");
    }
    for (let i = 0; i < 3; i++) {
      cached.BUN_SHARE_DELETE_A = "first";
      cached.BUN_SHARE_DELETE_B = "second";
      for (const key of ["BUN_SHARE_DELETE_A", "BUN_SHARE_DELETE_B"]) assert.equal(remove(key), true);
      const message = once(worker, "message");
      worker.postMessage("read");
      assert.deepEqual(await message, [{ first: undefined, second: undefined }]);
      assert.deepEqual(read(cached), { first: undefined, second: undefined });
      assert.equal(Object.hasOwn(cached, "BUN_SHARE_DELETE_A"), false);
      assert.equal(Object.keys(cached).includes("BUN_SHARE_DELETE_B"), false);
    }
  } finally {
    await worker.terminate();
  }
}

check().then(
  () => console.log("ok"),
  error => {
    console.error(error);
    process.exitCode = 1;
  },
);
