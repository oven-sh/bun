import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// A generator or async function is compiled as a wrapper (takes the parameters) and a body (runs later). A closure
// the body returns must keep only the parameters the body refers to. Each call below takes the previous closure as a
// parameter it never reads and returns a new closure over an 80 KB array. Before the fix, every wrapper put every
// parameter in its activation, so the chain kept all 500 arrays: about 40 MB. (oven-sh/bun#47903)
const makers = {
  "async function": `async previous => {
    await 0;
    const data = new Array(10_000).fill(1);
    return () => data.length;
  }`,
  "generator": `function* (previous) {
    yield 0;
    const data = new Array(10_000).fill(1);
    return () => data.length;
  }`,
  "async generator": `async function* (previous) {
    yield 0;
    const data = new Array(10_000).fill(1);
    return () => data.length;
  }`,
  "async method with an unused second parameter": `{ async method(key, previous) {
    await 0;
    const data = new Array(10_000).fill(1);
    return () => data.length + key;
  } }.method.bind(null, 0)`,
};

const script = (maker: string) => `
  const heapMB = () => (Bun.gc(true), Bun.gc(true), process.memoryUsage().heapUsed / 2 ** 20);
  const make = ${maker};
  let current = null;
  const before = heapMB();
  for (let i = 0; i < 500; i++) {
    const result = make(current);
    if (typeof result.next === "function") {
      await result.next();
      current = (await result.next()).value;
    } else
      current = await result;
  }
  if (current() < 10_000) throw new Error("the closure lost its own data");
  console.log((heapMB() - before).toFixed(1));
`;

test.concurrent.each(Object.entries(makers))(
  "a closure from the body of %s does not keep an unused parameter alive",
  async (_name, maker) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script(maker)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    // Unfixed, the heap grows by about 38 MB. The bound leaves room for GC jitter and the ASAN quarantine.
    const bound = isASAN || isDebug ? 12 : 6;
    const grewMB = Number(stdout.trim());
    expect(grewMB < bound ? "flat" : `grew ${grewMB} MB`).toBe("flat");
  },
);
