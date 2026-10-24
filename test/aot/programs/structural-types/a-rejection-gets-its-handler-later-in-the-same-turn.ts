function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "caught " + (error instanceof Error ? error.constructor.name : text(error));
}

const reports: string[] = [];
process.on("unhandledRejection", reason => {
  reports.push("unhandled " + failure(reason));
});

async function failsAtOnce(): Promise<number> {
  throw new RangeError("at once");
}

async function failsAfterAnAwait(): Promise<number> {
  await null;
  throw new TypeError("after an await");
}

const early = Promise.reject(new SyntaxError("made first"));
const fromAsync = failsAtOnce();
const slow = failsAfterAnAwait();
const list: Promise<number>[] = [Promise.reject(1), Promise.reject("two"), Promise.reject(undefined)];
let busy = 0;
for (let i = 0; i < 2000; i++) busy += i & 3;
console.log("work before any handler: " + busy);

const handled: Promise<string>[] = [
  early.then(text, failure),
  fromAsync.then(text, failure),
  slow.then(text, failure),
  ...list.map(p => p.then(text, failure)),
];
for (const line of await Promise.all(handled)) console.log(line);

async function keepsItInALocal(): Promise<string> {
  const doomed: Promise<number> = Promise.reject(new EvalError("kept in a local"));
  const guard = doomed.catch(() => -1);
  const first: number = await Promise.resolve(1);
  try {
    return "went on with " + (first + (await doomed));
  } catch (error) {
    return failure(error) + " and the guard gave " + (await guard);
  }
}
console.log(await keepsItInALocal());

async function twoAtOnce(): Promise<string> {
  const a = failsAfterAnAwait();
  const b = failsAtOnce();
  const results = await Promise.allSettled([a, b]);
  return results.map(r => (r.status === "rejected" ? failure(r.reason) : text(r.value))).join(" and ");
}
console.log(await twoAtOnce());

async function firstFailureWins(): Promise<string> {
  try {
    await Promise.all([failsAfterAnAwait(), failsAtOnce(), Promise.resolve(1)]);
    return "no failure";
  } catch (error) {
    return failure(error);
  }
}
console.log(await firstFailureWins());

const branch = Promise.reject(new URIError("two branches"));
const left = branch.then(() => "left went through", failure);
const right = branch.catch(failure);
const through = branch.finally(() => console.log("finally on a rejection")).catch(failure);
console.log((await left) + " | " + (await right) + " | " + (await through));

function rejectsLater(): Promise<number> {
  return new Promise<number>((_, reject) => {
    queueMicrotask(() => reject(new RangeError("in a later job")));
  });
}
const pending = rejectsLater();
const watched = pending.then(text, failure);
console.log(await watched);

await new Promise<void>(resolve => setImmediate(resolve));
console.log("reports: " + reports.length + " " + reports.join());

export {};
