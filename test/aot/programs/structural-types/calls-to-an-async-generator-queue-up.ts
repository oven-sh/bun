function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

let trail: string[] = [];

async function* worker(): AsyncGenerator<number, string, string> {
  trail.push("body starts");
  let heard = "";
  try {
    for (let i = 1; i <= 3; i++) {
      await null;
      const sent: string = yield i;
      trail.push("resumed with " + text(sent));
      heard += sent;
    }
    return "heard " + heard;
  } finally {
    trail.push("finally");
  }
}

function watch(label: string, promise: Promise<IteratorResult<number, string>>): Promise<void> {
  return promise.then(
    result => void trail.push(label + " -> " + text(result)),
    error => void trail.push(label + " -> " + failure(error)),
  );
}

async function round(title: string, start: (g: AsyncGenerator<number, string, string>) => Promise<void>[]): Promise<void> {
  trail = [];
  const g = worker();
  const watching = start(g);
  trail.push("all asked");
  await Promise.all(watching);
  console.log(title + ":");
  for (const line of trail) console.log("  " + line);
}

await round("five calls of next at once", g => [
  watch("next a", g.next("a")),
  watch("next b", g.next("b")),
  watch("next c", g.next("c")),
  watch("next d", g.next("d")),
  watch("next e", g.next("e")),
]);

await round("a return between two calls of next", g => [
  watch("next a", g.next("a")),
  watch("return", g.return("asked")),
  watch("next b", g.next("b")),
]);

await round("a throw between two calls of next", g => [
  watch("next a", g.next("a")),
  watch("throw", g.throw(new RangeError("thrown in"))),
  watch("next b", g.next("b")),
]);

await round("a return first", g => [
  watch("return", g.return("first of all")),
  watch("next a", g.next("a")),
]);

await round("a return with a slow promise and then next", g => [
  watch("next a", g.next("a")),
  watch("return", g.return(new Promise<string>(resolve => queueMicrotask(() => queueMicrotask(() => resolve("slow")))))),
  watch("next b", g.next("b")),
]);

async function* asksItself(): AsyncGenerator<number, void, void> {
  const self = holder.current;
  if (self !== undefined) {
    const inner = self.next();
    trail.push("asked itself while running");
    inner.then(result => void trail.push("the inner call -> " + text(result)));
  }
  yield 1;
  yield 2;
}
const holder: { current?: AsyncGenerator<number, void, void> } = {};
trail = [];
holder.current = asksItself();
trail.push("the outer call -> " + text(await holder.current.next()));
await null;
await null;
await null;
trail.push("the next call -> " + text(await holder.current.next()));
console.log("an async generator asks itself:");
for (const line of trail) console.log("  " + line);

export {};
