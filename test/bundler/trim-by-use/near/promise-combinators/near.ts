const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);
const later = <T>(value: T, after: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), after));

say("one after another", [
  await 1,
  await later(2, 1),
  await Promise.resolve(3),
  await { then: (resolve: (value: number) => void) => resolve(4) },
]);
say(
  "then, catch, finally",
  await later(1, 1)
    .then(value => value + 1)
    .finally(() => {})
    .then(value => Promise.reject(new Error("no " + value)))
    .catch(error => error.message),
);
const { promise, resolve } = Promise.withResolvers<string>();
setTimeout(() => resolve("resolved from outside"), 1);
say("withResolvers", await promise);
say("try", await (Promise as unknown as { try<T>(make: () => T): Promise<T> }).try(() => 5));
async function together<T>(promises: Promise<T>[]) {
  const values: T[] = [];
  for (const one of promises) values.push(await one);
  return values;
}
say("many, by hand", await together([later("a", 3), later("b", 1), later("c", 2)]));
say(
  "the first, by hand",
  await new Promise(resolve => [later("slow", 4), later("fast", 1)].forEach(one => one.then(resolve))),
);
async function* ticking() {
  for (let at = 0; at < 3; at++) yield await later(at, 1);
}
const ticks: number[] = [];
for await (const tick of ticking()) ticks.push(tick);
say("for await", ticks);
say("arrays have their own", [[1, 2].every(value => value > 0), [1, 2].some(value => value > 1)]);
class Mine<T> extends Promise<T> {}
say("a subclass", [Mine.resolve(1) instanceof Mine, await Mine.resolve(1).then(value => value + 1)]);
process.on("unhandledRejection", reason => say("unhandled", String(reason)));
queueMicrotask(() => say("a microtask", true));
await later(0, 2);
console.log(lines.join("\n"));
