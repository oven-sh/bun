// Stress fixture: many workers (plus the main thread) concurrently register
// namespaced Bun.plugin onLoad/onResolve callbacks. Namespace validation must
// be safe to call from multiple VMs at once.

const WORKERS = 8;
const ITERS = 4000;

function hammer(tag: string) {
  const valid = ["abc", "abc-def", "a/b", "@scope/pkg", "A_Z-0/9", "x"];
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < ITERS; i++) {
    const ns = valid[i % valid.length];
    Bun.plugin({
      name: `p-${tag}-${i}`,
      setup(b) {
        b.onLoad({ filter: /.*/, namespace: ns }, () => ({ contents: "", loader: "js" }));
        b.onResolve({ filter: /.*/, namespace: ns }, ({ path }) => ({ path, namespace: ns }));
      },
    });
    accepted++;
    let threw: unknown;
    try {
      Bun.plugin({
        name: `q-${tag}-${i}`,
        setup(b) {
          b.onLoad({ filter: /.*/, namespace: "bad ns!" }, () => ({ contents: "", loader: "js" }));
        },
      });
    } catch (e) {
      threw = e;
    }
    if (!String((threw as Error)?.message).includes("namespace can only contain")) {
      throw new Error(`${tag}: "bad ns!" was not rejected (got: ${threw})`);
    }
    rejected++;
  }
  if (accepted !== ITERS || rejected !== ITERS) {
    throw new Error(`${tag}: accepted=${accepted} rejected=${rejected} (expected ${ITERS} each)`);
  }
}

if (Bun.isMainThread) {
  const workers: Worker[] = [];
  const dones: Promise<void>[] = [];
  for (let i = 0; i < WORKERS; i++) {
    const w = new Worker(import.meta.url);
    workers.push(w);
    dones.push(
      new Promise<void>((resolve, reject) => {
        w.onmessage = e => (e.data === "done" ? resolve() : reject(new Error(String(e.data))));
        w.onerror = e => reject(new Error((e as any)?.message ?? String(e)));
      }),
    );
  }
  hammer("main");
  await Promise.all(dones);
  for (const w of workers) w.terminate();
  console.log("PASS");
} else {
  try {
    hammer("worker");
    postMessage("done");
  } catch (e) {
    postMessage(`error: ${(e as Error).message}`);
  }
}
