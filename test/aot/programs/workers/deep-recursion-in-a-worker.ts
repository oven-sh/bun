// A Worker's stack is its own: plain recursion, recursion through native functions, through getters, proxies, JSON, patterns and promises ends in a RangeError that is caught, as on the main thread, and the thread goes on.
function plain(n: number): number {
  return 1 + plain(n + 1);
}
function throughSort(n: number): number {
  return [2, 1].sort(() => throughSort(n + 1))[0];
}
function throughMap(n: number): number {
  return [n].map(v => throughMap(v + 1))[0];
}
function throughApply(n: number): number {
  return 1 + Reflect.apply(throughApply, null, [n + 1]);
}
function throughReplace(n: number): string {
  return "a".replace(/a/, () => throughReplace(n + 1));
}
function throughJSON(n: number): string {
  return JSON.stringify({ toJSON: () => throughJSON(n + 1) });
}
const getter = { get deeper(): number { return this.deeper + 1; } };
const proxy: any = new Proxy({}, { get: (_, key) => proxy[key] });
class Node2 { constructor(public depth: number) { new Node2(depth + 1); } }
function throughSpread(...list: number[]): number {
  return 1 + throughSpread(...list.slice(-3), 1);
}
function throughToString(n: number): string {
  return `${{ toString: () => throughToString(n + 1) }}`;
}
function throughBound(n: number): number {
  return 1 + throughBound.bind(null, n + 1)();
}
function* generator(n: number): Generator<number> {
  yield* generator(n + 1);
}
const deepList = () => { let list: unknown[] = []; for (let i = 0; i < 200_000; i++) list = [list]; return list; };
const tries: Record<string, () => unknown> = {
  plain: () => plain(0), sort: () => throughSort(0), map: () => throughMap(0), apply: () => throughApply(0), replace: () => throughReplace(0), json: () => throughJSON(0),
  getter: () => getter.deeper, proxy: () => proxy.anything, construct: () => new Node2(0), spread: () => throughSpread(), toString: () => throughToString(0), bound: () => throughBound(0),
  generator: () => [...generator(0)], "a deep list as JSON": () => JSON.stringify(deepList()), "a deep list as text": () => String(deepList()), "a deep list flattened": () => deepList().flat(Infinity).length,
  "a deep list cloned": () => typeof structuredClone(deepList()), "a deep text parsed": () => typeof JSON.parse("[".repeat(200_000) + "]".repeat(200_000)),
};
function all(): string {
  const out: string[] = [];
  for (let round = 0; round < 2; round++)
    for (const name of Object.keys(tries)) {
      if (process.env.ONLY && process.env.ONLY !== name) continue;
      try {
        out.push(name + "=" + String(tries[name]()).slice(0, 20));
      } catch (error) {
        out.push(name + ":" + (error as Error).name);
      }
    }
  return out.join(" ");
}

if (Bun.isMainThread) {
  const mine = all();
  console.log(mine);
  const workers = Array.from({ length: 4 }, () => new Worker(new URL(import.meta.url)));
  const answers = await Promise.all(workers.map(worker => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => (resolve("error " + event.message.slice(0, 80)), event.preventDefault());
  })));
  console.log("as here:", answers.filter(answer => answer === mine).length);
  for (const answer of new Set(answers)) if (answer !== mine) console.log("ANOTHER", answer);
  for (const worker of workers) worker.terminate();
} else postMessage(all());
