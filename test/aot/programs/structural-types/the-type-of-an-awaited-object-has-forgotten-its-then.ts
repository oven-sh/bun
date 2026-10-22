function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "caught " + (error instanceof Error ? error.constructor.name : text(error));
}

interface Labeled {
  label: string;
  size: number;
}

class Plain implements Labeled {
  label = "plain";
  size = 1;
}

class Sneaky implements Labeled {
  label = "sneaky";
  size = 2;
  then(resolve: (value: number) => void): void {
    console.log("  the then of sneaky runs");
    resolve(42);
  }
}

class Refuses implements Labeled {
  label = "refuses";
  size = 3;
  then(_: (value: number) => void, reject: (reason: string) => void): void {
    console.log("  the then of refuses runs");
    reject("refused");
  }
}

class NotCallable implements Labeled {
  label = "not callable";
  size = 4;
  then = 5;
}

async function labelOf(item: Labeled): Promise<string> {
  const same: Labeled = await item;
  return text(same) + " | label " + text(same.label) + " | size " + text(same.size) + " | size + 1 " + text(same.size + 1) + " | same " + (same === item);
}

async function upper(item: Labeled): Promise<string> {
  const same = await item;
  return same.label.toUpperCase();
}

async function handBack(item: Labeled): Promise<Labeled> {
  return item;
}

function resolved(item: Labeled): Promise<Labeled> {
  return Promise.resolve(item);
}

function chained(item: Labeled): Promise<Labeled> {
  return Promise.resolve(0).then(() => item);
}

async function together(items: Labeled[]): Promise<string> {
  const all: Labeled[] = await Promise.all(items);
  return all.map(one => text(one.label)).join();
}

async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(label + ": " + text(await run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let warm = "";
for (let i = 0; i < 2000; i++) warm = await upper(new Plain());
console.log("2000 plain ones: " + warm);

const makers: [string, () => Labeled][] = [
  ["plain", () => new Plain()],
  ["a literal", () => ({ label: "literal", size: 0 })],
  ["sneaky", () => new Sneaky()],
  ["refuses", () => new Refuses()],
  ["then is a number", () => new NotCallable()],
];

for (const [name, make] of makers) {
  await attempt(name + ", awaited", () => labelOf(make()));
  await attempt(name + ", awaited and used", () => upper(make()));
  await attempt(name + ", handed back", async () => (await handBack(make())).label);
  await attempt(name + ", Promise.resolve", async () => (await resolved(make())).label);
  await attempt(name + ", a reaction's result", async () => (await chained(make())).size + 1);
  await attempt(name + ", Promise.all", () => together([new Plain(), make()]));
}

await attempt("plain again", () => upper(new Plain()));

export {};
