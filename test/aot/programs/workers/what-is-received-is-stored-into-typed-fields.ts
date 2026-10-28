// What a thread receives is stored into fields, lists, maps and variables of declared types, beside objects born there, and used by the same hot functions. Then it is changed, grown, shrunk, frozen, given a prototype.
type Point = { x: number; y: number };
type Segment = { from: Point; to: Point; label: string };
class Path {
  points: Point[] = [];
  last: Point | null = null;
  byLabel = new Map<string, Segment>();
  add(point: Point): void {
    this.points.push(point);
    this.last = point;
  }
  length(): number {
    let sum = 0;
    for (let i = 1; i < this.points.length; i++) sum += Math.abs(this.points[i].x - this.points[i - 1].x) + Math.abs(this.points[i].y - this.points[i - 1].y);
    return sum;
  }
}
function measure(segment: Segment): number {
  return Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y) + segment.label.length;
}
let current: Point = { x: 0, y: 0 };
function use(name: string, received: { point: Point; points: Point[]; segment: Segment }): string {
  const path = new Path();
  for (let round = 0; round < 500; round++) {
    path.add({ x: round, y: round });
    path.add(received.point);
    path.add(received.points[round % received.points.length]);
    current = round % 2 ? received.point : { x: 1, y: 1 };
  }
  const mixed: Segment = { from: received.point, to: { x: 5, y: 5 }, label: "mixed" };
  const other: Segment = { from: { x: 1, y: 1 }, to: received.segment.to, label: received.segment.label };
  path.byLabel.set("r", received.segment).set("m", mixed).set("o", other);
  let sum = 0;
  for (let round = 0; round < 500; round++) for (const segment of path.byLabel.values()) sum += measure(segment);
  received.point.x += 10;
  (received.point as any).z = 3;
  delete (received.points[0] as any).y;
  received.points.length = 2;
  received.points.push({ x: 9, y: 9 });
  Object.freeze(received.segment.from);
  let frozenStore = "stored";
  try {
    "use strict";
    received.segment.from.x = 77;
  } catch (error) {
    frozenStore = (error as Error).name;
  }
  Object.setPrototypeOf(received.segment, { inherited: "yes" });
  return [name, path.length(), sum, current.x, path.last!.x, JSON.stringify(received), frozenStore, (received.segment as any).inherited, measure(received.segment), measure(mixed), Number.isNaN(path.length())].join(" ");
}
const parcel = () => ({ point: { x: 2, y: 3 }, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], segment: { from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, label: "seg" } });

if (Bun.isMainThread) {
  console.log(use("born here", parcel()));
  console.log(use("cloned", structuredClone(parcel())));
  console.log(use("parsed", JSON.parse(JSON.stringify(parcel()))));
  const worker = new Worker(new URL(import.meta.url));
  const first = await new Promise<any>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.postMessage(parcel());
  });
  console.log(first.line);
  console.log(use("sent back", first.parcel));
  worker.terminate();
} else {
  addEventListener("message", (event: MessageEvent<ReturnType<typeof parcel>>) => postMessage({ line: use("in the worker", event.data), parcel: parcel() }));
}
