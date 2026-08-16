// SHARE_ENV shares the *creating thread's* environment store, not a process-wide
// one (node_worker.cc: `env_vars = env->env_vars()`), so disjoint SHARE_ENV chains
// stay isolated. A subprocess, so the runner's own process.env is never mutated.
const { Worker, isMainThread, workerData, parentPort, SHARE_ENV } = require("worker_threads");

function spawn(data, env) {
  return new Promise((resolve, reject) => {
    const options = { workerData: data };
    if (env !== undefined) options.env = env;
    const worker = new Worker(__filename, options);
    let out = null;
    worker.on("message", m => (out = m));
    worker.on("error", reject);
    worker.on("exit", code => (code === 0 ? resolve(out) : reject(new Error(`worker ${data.role} exited ${code}`))));
  });
}

const orNull = v => (v === undefined ? null : v);

async function main() {
  const mode = process.argv[2];

  if (mode === "tree") {
    process.env.FROM_MAIN = "main";
    const a = await spawn({ role: "A", mode }); // default env => snapshot of main's env
    const c = await spawn({ role: "C", mode }, SHARE_ENV); // shares main's env store
    console.log(
      JSON.stringify({
        B_sees_FROM_A: a.B.B_sees_FROM_A,
        B_sees_FROM_MAIN: a.B.B_sees_FROM_MAIN,
        A_sees_FROM_B: a.A_sees_FROM_B,
        C_sees_FROM_B: c.C_sees_FROM_B,
        C_sees_FROM_MAIN: c.C_sees_FROM_MAIN,
        main_sees_FROM_B: orNull(process.env.FROM_B),
        main_sees_FROM_C: orNull(process.env.FROM_C),
      }),
    );
    return;
  }

  if (mode === "clobber") {
    process.env.SHARED_KEY = "from-main";
    await spawn({ role: "C", mode }, SHARE_ENV); // founds a store rooted at main
    const a = await spawn({ role: "A", mode }, { SHARED_KEY: "from-A" });
    console.log(JSON.stringify({ ...a, main_SHARED_KEY: orNull(process.env.SHARED_KEY) }));
    return;
  }

  if (mode === "siblings") {
    process.env.TO_DELETE = "present";
    await spawn({ role: "S1", mode }, SHARE_ENV);
    const s2 = await spawn({ role: "S2", mode }, SHARE_ENV);
    console.log(
      JSON.stringify({
        s2_sees_S1_write: s2.sees_S1_write,
        s2_sees_TO_DELETE: s2.sees_TO_DELETE,
        s2_keys_have_FROM_S1: s2.keys_have_FROM_S1,
        grandchild_sees_S1_write: s2.grandchild_sees_S1_write,
        main_sees_FROM_S1: orNull(process.env.FROM_S1),
        main_sees_TO_DELETE: orNull(process.env.TO_DELETE),
      }),
    );
    return;
  }

  // Integer-like keys route through JSC's indexed hooks, not the named ones.
  if (mode === "indexed") {
    process.env["123"] = "from-main";
    process.env["7"] = "seven";
    const a = await spawn({ role: "A", mode }, SHARE_ENV);
    console.log(
      JSON.stringify({
        ...a,
        main_sees_456: orNull(process.env["456"]),
        main_sees_123: orNull(process.env["123"]),
        main_sees_7_after_delete: orNull(process.env["7"]),
      }),
    );
    return;
  }

  throw new Error(`unknown mode ${mode}`);
}

async function worker() {
  const { role, mode } = workerData;

  if (mode === "tree") {
    if (role === "A") {
      process.env.FROM_A = "a";
      const b = await spawn({ role: "B", mode }, SHARE_ENV); // shares *A's* store
      parentPort.postMessage({ B: b, A_sees_FROM_B: orNull(process.env.FROM_B) });
    } else if (role === "B") {
      process.env.FROM_B = "b";
      parentPort.postMessage({
        B_sees_FROM_A: orNull(process.env.FROM_A),
        B_sees_FROM_MAIN: orNull(process.env.FROM_MAIN),
      });
    } else if (role === "C") {
      process.env.FROM_C = "c";
      parentPort.postMessage({
        C_sees_FROM_B: orNull(process.env.FROM_B),
        C_sees_FROM_MAIN: orNull(process.env.FROM_MAIN),
      });
    }
    return;
  }

  if (mode === "clobber") {
    if (role === "A") {
      const before = orNull(process.env.SHARED_KEY);
      const b = await spawn({ role: "B", mode }, SHARE_ENV);
      parentPort.postMessage({
        A_SHARED_KEY_before: before,
        A_SHARED_KEY_after: orNull(process.env.SHARED_KEY),
        B_sees_SHARED_KEY: b.SHARED_KEY,
      });
    } else if (role === "B") {
      parentPort.postMessage({ SHARED_KEY: orNull(process.env.SHARED_KEY) });
    } else if (role === "C") {
      parentPort.postMessage({ ok: true });
    }
    return;
  }

  if (mode === "indexed") {
    const sees123 = orNull(process.env["123"]);
    process.env["456"] = "from-worker";
    delete process.env["7"];
    parentPort.postMessage({
      worker_sees_123: sees123,
      worker_keys_numeric: Object.keys(process.env)
        .filter(k => /^\d+$/.test(k))
        .sort(),
    });
    return;
  }

  if (mode === "siblings") {
    if (role === "S1") {
      process.env.FROM_S1 = "s1";
      delete process.env.TO_DELETE;
      parentPort.postMessage({ ok: true });
    } else if (role === "S2") {
      const g = await spawn({ role: "G", mode }); // default env => snapshot of the shared store
      parentPort.postMessage({
        sees_S1_write: orNull(process.env.FROM_S1),
        sees_TO_DELETE: orNull(process.env.TO_DELETE),
        keys_have_FROM_S1: Object.keys(process.env).includes("FROM_S1"),
        grandchild_sees_S1_write: g.sees_FROM_S1,
      });
    } else if (role === "G") {
      parentPort.postMessage({ sees_FROM_S1: orNull(process.env.FROM_S1) });
    }
  }
}

(isMainThread ? main() : worker()).catch(err => {
  console.error(err);
  process.exit(1);
});
