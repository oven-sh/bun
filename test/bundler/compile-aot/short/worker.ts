import { inOther } from "./other";
function inWorker(a: number, b: number, c: number) { return a + b + c; }
const named = { method(x: any) { return x; }, get g() { return 1; } };
self.onmessage = (e: MessageEvent) => {
  const d = Object.getOwnPropertyDescriptor(named, "g")!;
  postMessage([inWorker.name, inWorker.length, inWorker(1, 2, 3), inOther.name, inOther.length, named.method.name, d.get!.name, String(inWorker).slice(0, 17), e.data].join("|"));
};
