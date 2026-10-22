import { inspect, promisify } from "node:util";

class Deferred extends Promise<number> {}
class Rows extends Array<number> {}
class Index extends Map<string, number> {}

console.log(Bun.peek(Promise.resolve(5)), Bun.peek(7), Bun.peek(Deferred.resolve(6)));
console.log(Bun.peek.status(Promise.resolve(1)), Bun.peek.status(new Promise(() => {})), Bun.peek.status("text" as never));
console.log(inspect([1, 2, new Map([[1, 2]]), new Set([3])]));
console.log(inspect(Rows.from([1, 2])), inspect(new Index([["a", 1]])));
console.log(inspect(new Proxy([1], {}), { showProxy: true }), inspect(new Proxy({ a: 1 }, {})));
console.log(Buffer.from(new Uint8Array([1, 2])), Buffer.from(new Float32Array([1])).length, Buffer.from(new DataView(new ArrayBuffer(2)) as never).length);
new Map([[1, 2]]).forEach((value, key) => console.log(key, value));
try {
  Map.prototype.forEach.call(new Set([1]), () => {});
} catch (error) {
  console.log((error as Error).name);
}
const sleep = promisify((done: (error: null, value: number) => void) => done(null, 3));
console.log(await sleep());
