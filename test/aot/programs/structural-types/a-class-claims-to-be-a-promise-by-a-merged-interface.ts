function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Pledge extends Promise<number> {}
class Pledge {
  id: number = 1;
}

async function plusOne(promise: Promise<number>): Promise<number> {
  return (await promise) + 1;
}

async function kindOf(promise: Promise<number>): Promise<string> {
  const value = await promise;
  return typeof value;
}

function chained(promise: Promise<number>): Promise<number> {
  return promise.then(n => n * 2);
}

async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    show(label, () => value);
  } catch (error) {
    show(label, () => {
      throw error;
    });
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += (await plusOne(Promise.resolve(i))) + (await chained(Promise.resolve(1)));
show("2000 honest rounds", () => warm);

const pledge = new Pledge();
await attempt("awaited and one added", () => plusOne(pledge));
await attempt("what await hands out", () => kindOf(pledge));
await attempt("awaited here", async () => {
  const value: number = await pledge;
  return [typeof value, JSON.stringify(value)];
});
await attempt("then", async () => chained(pledge));
await attempt("typeof then", async () => typeof pledge.then);
await attempt("Promise.all", async () => {
  const values: number[] = await Promise.all([pledge, Promise.resolve(2)]);
  return values.map(v => typeof v);
});
await attempt("Promise.race", async () => typeof (await Promise.race([pledge])));
await attempt("Promise.resolve makes a new one", async () => Promise.resolve(pledge) instanceof Promise);
await attempt("returned from an async function", async () => {
  const returns = async (): Promise<number> => pledge;
  return typeof (await returns());
});
await attempt("instanceof", async () => pledge instanceof Promise);
await attempt("honest again", async () => [await plusOne(Promise.resolve(1)), await kindOf(Promise.resolve(1)), await chained(Promise.resolve(2))]);

export {};
