function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

export {};

interface Cell {
  value: number | string;
  inner: { n: number } | null;
}

async function afterAwait(c: Cell): Promise<number> {
  if (typeof c.value === "number") {
    await null;
    return c.value + 1;
  }
  return -1;
}

async function innerAfterAwait(c: Cell): Promise<number> {
  if (c.inner !== null) {
    await null;
    return c.inner.n;
  }
  return -1;
}

function* afterYield(c: Cell): Generator<string, number, void> {
  if (typeof c.value === "number") {
    yield "paused";
    return c.value + 1;
  }
  return -1;
}

async function capturedAfterAwait(spoil: boolean): Promise<number> {
  let v: number | string = 1;
  const change = async () => {
    v = "text";
  };
  if (typeof v === "number") {
    if (spoil) await change();
    else await null;
    return v + 1;
  }
  return -1;
}

async function attemptAsync(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(label, "->", show(await run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

const make = (): Cell => ({ value: 1, inner: { n: 5 } });

await attemptAsync("honest await", () => afterAwait(make()));
await attemptAsync("honest inner", () => innerAfterAwait(make()));
attempt("honest yield", () => {
  const g = afterYield(make());
  return [g.next().value, g.next().value];
});
await attemptAsync("honest captured", () => capturedAfterAwait(false));
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += (await afterAwait(make())) + (await innerAfterAwait(make()));
  const g = afterYield(make());
  g.next();
  warm += Number(g.next().value);
}
console.log("2000 honest rounds", warm);

await attemptAsync("changed during the await", () => {
  const c = make();
  const running = afterAwait(c);
  c.value = "text";
  return running;
});
await attemptAsync("cleared during the await", () => {
  const c = make();
  const running = innerAfterAwait(c);
  c.inner = null;
  return running;
});
attempt("changed during the yield", () => {
  const c = make();
  const g = afterYield(c);
  g.next();
  c.value = "text";
  return g.next().value;
});
await attemptAsync("a captured variable changed during the await", () => capturedAfterAwait(true));
await attemptAsync("two runs over one cell", async () => {
  const c = make();
  const spoil = async (): Promise<number> => {
    c.value = "spoiled";
    return 0;
  };
  return Promise.all([afterAwait(c), spoil(), afterAwait(c)]);
});
await attemptAsync("for await and a narrowed element", async () => {
  const cells: Cell[] = [make(), make()];
  async function* each(): AsyncGenerator<Cell> {
    for (const c of cells) yield c;
  }
  const results: number[] = [];
  for await (const c of each()) {
    if (typeof c.value === "number") {
      cells[0].value = "first";
      cells[1].value = "second";
      await null;
      results.push(c.value + 1);
    }
  }
  return results;
});
await attemptAsync("honest again", () => afterAwait(make()));
