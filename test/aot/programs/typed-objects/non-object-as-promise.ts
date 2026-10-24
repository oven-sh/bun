// `await` takes what is no promise. A place written `Promise<T>` (a variable, a parameter, a field, a result) is tested like any object type: undefined, null and every object, a thenable or not, pass and stay what they are. A number or a string is no object: `v as Promise<unknown>` throws a TypeError.
class Job { pending: Promise<unknown>; constructor(pending: Promise<unknown>) { this.pending = pending } }
async function wait(p: Promise<unknown>): Promise<unknown> { return await p }
function asPromise(v: unknown): Promise<unknown> { return v as Promise<unknown> }
const values: [string, unknown][] = [["a number", 7], ["a string", "text"], ["undefined", undefined], ["null", null], ["a thenable", { then(done: (n: number) => void) { done(9) } }], ["a plain object", { n: 1 }], ["a promise", Promise.resolve(3)]];
for (const [name, v] of values) {
  try {
    const held: Promise<unknown> = v as Promise<unknown>;
    console.log("a variable, " + name + ": " + typeof held + " " + String(await held).slice(0, 15));
  } catch (e) { console.log("a variable, " + name + ": " + (e as Error).constructor.name); }
  try { console.log("a parameter, " + name + ": " + String(await wait(v as Promise<unknown>)).slice(0, 15)); } catch (e) { console.log("a parameter, " + name + ": " + (e as Error).constructor.name); }
  try {
    const record: { pending: Promise<unknown> } = { pending: v as Promise<unknown> };
    console.log("a field, " + name + ": " + typeof record.pending);
  } catch (e) { console.log("a field, " + name + ": " + (e as Error).constructor.name); }
  try { console.log("a field of a class, " + name + ": " + typeof new Job(v as Promise<unknown>).pending); } catch (e) { console.log("a field of a class, " + name + ": " + (e as Error).constructor.name); }
  try { console.log("a result, " + name + ": " + typeof asPromise(v)); } catch (e) { console.log("a result, " + name + ": " + (e as Error).constructor.name); }
}
