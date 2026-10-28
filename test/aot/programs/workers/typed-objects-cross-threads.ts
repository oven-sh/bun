// Typed objects cross threads by every road (postMessage, workerData, a port, receiveMessageOnPort, BroadcastChannel, environment data) and are used at once as their declared types in hot code, beside objects born on the spot. What arrives is a plain copy: no class, no layout of the sender's thread.
import { BroadcastChannel as NodeBroadcast, MessageChannel as NodeChannel, Worker as NodeWorker, getEnvironmentData, isMainThread, parentPort, receiveMessageOnPort, setEnvironmentData, workerData } from "node:worker_threads";

class Vector {
  x: number;
  y: number;
  label: string;
  constructor(x: number, y: number, label: string) {
    this.x = x;
    this.y = y;
    this.label = label;
  }
  length(): number {
    return Math.hypot(this.x, this.y);
  }
}
type Plain = { x: number; y: number; label: string };
type Order = { id: number; lines: { item: string; count: number; price: number }[]; buyer: { name: string; address?: { city: string } } | null; note?: string };
interface Tree {
  value: number;
  left: Tree | null;
  right: Tree | null;
}

function total(order: Order): number {
  let sum = 0;
  for (const line of order.lines) sum += line.count * line.price;
  return sum + order.id + (order.buyer?.address?.city.length ?? -1) + (order.note?.length ?? 0);
}
function norm(vector: Plain): string {
  return (vector.x * vector.x + vector.y * vector.y).toFixed(2) + vector.label;
}
function sumTree(tree: Tree | null): number {
  return tree === null ? 0 : tree.value + sumTree(tree.left) + sumTree(tree.right);
}
function grow(depth: number, value: number): Tree | null {
  return depth === 0 ? null : { value, left: grow(depth - 1, value * 2), right: grow(depth - 1, value * 2 + 1) };
}
function facts(value: any): string {
  return [value instanceof Vector, Object.getPrototypeOf(value) === Object.prototype, typeof value.length, Object.keys(value).join()].join(" ");
}
const order = (id: number): Order => ({ id, lines: [{ item: "a", count: 2, price: 1.5 }, { item: "b", count: 1, price: 10 }], buyer: id % 2 ? { name: "n", address: { city: "city" } } : null, ...(id % 3 ? { note: "note" } : {}) });

function useAll(name: string, got: { vector: Vector; plain: Plain; orders: Order[]; tree: Tree; mixed: (Vector | Plain)[]; odd: any }): string {
  let text = 0;
  for (let round = 0; round < 300; round++) {
    const mine = new Vector(round, 1, "m");
    text += norm(mine).length + norm(got.vector).length + norm(got.plain).length;
    for (const each of got.orders) text += total(each);
    text += total(order(round));
    for (const each of got.mixed) text += norm(each).length;
  }
  got.vector.x = 100;
  got.plain.label += "!";
  (got.vector as any).added = 1;
  got.orders[0].lines.push({ item: "c", count: 1, price: 1 });
  let called = "";
  try {
    called = String(got.vector.length());
  } catch (error) {
    called = (error as Error).name;
  }
  return `${name}: ${text} ${sumTree(got.tree)} ${facts(got.vector)} | ${called} | ${norm(got.vector)} ${norm(got.plain)} ${total(got.orders[0])} | ${norm(got.odd)} ${JSON.stringify(got.odd)}`;
}
function parcel() {
  const odd: any = new Vector(1, 2, "odd");
  odd.x = "text where a number is declared";
  delete odd.y;
  return { vector: new Vector(3, 4, "v"), plain: { x: 1, y: 2, label: "p" } as Plain, orders: [order(1), order(2), order(3)], tree: grow(8, 1)!, mixed: [new Vector(1, 1, "a"), { x: 2, y: 2, label: "b" }, new Vector(3, 3, "c")], odd };
}

if (isMainThread) {
  console.log(useAll("born here", parcel()));
  console.log(useAll("cloned here", structuredClone(parcel())));
  setEnvironmentData("parcel", parcel());
  const worker = new NodeWorker(new URL(import.meta.url), { workerData: parcel() });
  const lines: string[] = [];
  const channel = new NodeChannel();
  let listens = () => {};
  const listening = new Promise<void>(resolve => (listens = resolve));
  const done = new Promise<void>(resolve => worker.on("message", (message: any) => {
    if (message === "listens") return listens();
    if (typeof message === "string") return void lines.push(message);
    if (message.done) return resolve();
    lines.push(useAll("back on the main thread", message));
  }));
  await new Promise(resolve => worker.once("online", resolve));
  worker.postMessage({ port: channel.port2 }, [channel.port2]);
  worker.postMessage(parcel());
  channel.port1.postMessage(parcel());
  channel.port1.postMessage(parcel());
  const news = new NodeBroadcast("parcels");
  await listening;
  news.postMessage(parcel());
  await done;
  news.close();
  channel.port1.close();
  for (const line of lines.sort()) console.log(line);
  await worker.terminate();
} else {
  const post = (value: unknown) => parentPort!.postMessage(value);
  post(useAll("workerData", workerData));
  post(useAll("environment data", getEnvironmentData("parcel") as any));
  post(useAll("born in the worker", parcel()));
  let left = 4;
  const one = () => --left === 0 && (post(parcel()), post({ done: true }));
  const news = new NodeBroadcast("parcels");
  news.onmessage = (event: any) => (post(useAll("a broadcast", event.data)), news.close(), one());
  post("listens");
  parentPort!.on("message", (message: any) => {
    if (message.port) {
      const wait = setInterval(() => {
        const first = receiveMessageOnPort(message.port);
        if (!first) return;
        clearInterval(wait);
        post(useAll("received at once", first.message));
        one();
        message.port.once("message", (second: any) => (post(useAll("a port", second)), message.port.close(), one()));
      }, 1);
    } else post(useAll("postMessage", message)), one();
  });
}
