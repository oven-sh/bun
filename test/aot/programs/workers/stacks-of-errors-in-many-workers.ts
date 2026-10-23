// Sixteen Workers throw and catch errors in compiled code and read their stacks, all for the first time at the same moment; every stack names the same functions and lines as the main thread's.
class Validation extends Error {
  constructor(public field: string) {
    super("bad " + field);
    this.name = "Validation";
  }
}
function inner(kind: number): never {
  if (kind === 0) throw new Validation("name");
  if (kind === 1) (undefined as any).member;
  if (kind === 2) (null as any)();
  if (kind === 3) new Array(-1);
  if (kind === 4) JSON.parse("{");
  if (kind === 5) [1].reduce(() => { throw new RangeError("in a callback"); }, 0);
  if (kind === 6) BigInt(1.5);
  throw new Error("plain");
}
function middle(kind: number): never {
  return inner(kind);
}
async function later(kind: number): Promise<never> {
  await null;
  return middle(kind);
}
const clean = (stack: string | undefined) => (stack ?? "none").split("\n").map((line, index) => (index === 0 ? line.split(":")[0] : line)).map(line => line.trim().replace(/\(?(?:file:\/\/)?(?:[A-Z]:)?[\\/][^)]*[\\/]([^\\/)]+)\)?$/, "$1")).filter(line => !/native|bun:|node:|internal|processTicks/.test(line)).join(" < ");
async function all(): Promise<string> {
  const lines: string[] = [];
  for (let kind = 0; kind < 8; kind++) {
    try {
      middle(kind);
    } catch (error) {
      lines.push(clean((error as Error).stack));
    }
    try {
      await later(kind);
    } catch (error) {
      lines.push(clean((error as Error).stack));
    }
  }
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder);
  lines.push(clean(holder.stack));
  return lines.join("\n");
}

if (Bun.isMainThread) {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const workers = Array.from({ length: 16 }, () => new Worker(new URL(import.meta.url)));
  const answers = workers.map(worker => new Promise<string>(resolve => (worker.onmessage = event => resolve(event.data))));
  for (const worker of workers) worker.postMessage(gate);
  await new Promise(resolve => setTimeout(resolve, 100));
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  const got = await Promise.all(answers);
  const mine = await all();
  console.log(mine);
  console.log("as here:", got.filter(answer => answer === mine).length);
  for (const answer of new Set(got)) if (answer !== mine) console.log("ANOTHER:\n" + answer);
  for (const worker of workers) worker.terminate();
} else {
  addEventListener("message", async (event: MessageEvent<Int32Array>) => {
    Atomics.wait(event.data, 0, 0);
    postMessage(await all());
  });
}
