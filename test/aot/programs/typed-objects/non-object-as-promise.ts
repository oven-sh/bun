// `await` takes what is no promise, and so does a place for a Promise: a variable, a parameter, a field, a result.
class Job { pending: Promise<unknown>; constructor(pending: Promise<unknown>) { this.pending = pending } }
async function wait(p: Promise<unknown>): Promise<unknown> { return await p }
function asPromise(v: unknown): Promise<unknown> { return v as Promise<unknown> }
const values: [string, unknown][] = [["a number", 7], ["a string", "text"], ["undefined", undefined], ["null", null], ["a thenable", { then(done: (n: number) => void) { done(9) } }], ["a plain object", { n: 1 }], ["a promise", Promise.resolve(3)]];
for (const [name, v] of values) {
  const held: Promise<unknown> = v as Promise<unknown>;
  console.log("a variable, " + name + ": " + typeof held + " " + String(await held).slice(0, 15));
  console.log("a parameter, " + name + ": " + String(await wait(v as Promise<unknown>)).slice(0, 15));
  const record: { pending: Promise<unknown> } = { pending: v as Promise<unknown> };
  console.log("a field, " + name + ": " + typeof record.pending);
  console.log("a field of a class, " + name + ": " + typeof new Job(v as Promise<unknown>).pending);
  console.log("a result, " + name + ": " + typeof asPromise(v));
}
