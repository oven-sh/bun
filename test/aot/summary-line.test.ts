import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { describe, test } from "./supported";

const stock = `export interface Item {
  sku: string;
  price: number;
  quantity: number;
}

export class Stock {
  items: Item[] = [];

  add(item: Item): void {
    this.items.push(item);
  }

  value(): number {
    let sum = 0;
    for (const item of this.items) sum += item.price * item.quantity;
    return sum;
  }
}
`;

const begins = `const stock = new Stock();
stock.add({ sku: "A-1", price: 2.5, quantity: 4 });
`;

const programs: Record<string, Record<string, string>> = {
  "a server that only reads its own type and what Bun provides": {
    "main.ts": `interface Todo {
  id: number;
  title: string;
}
const todos: Todo[] = [{ id: 1, title: "one" }];
const server = Bun.serve({
  port: 0,
  routes: {
    "/todos": () => Response.json(todos),
    "/todos/:id": req => Response.json(todos.find(todo => todo.id === Number(req.params.id)) ?? null),
  },
});
console.log(server.url.href);
server.stop();
`,
  },
  "a class and a loop": {
    "main.ts": `class Account {
  constructor(
    public id: number,
    public balance: number,
  ) {}
}
function total(accounts: Account[]): number {
  let sum = 0;
  for (const account of accounts) sum += account.balance;
  return sum;
}
const accounts: Account[] = [];
for (let id = 0; id < 10; id++) accounts.push(new Account(id, id % 3));
console.log(total(accounts));
`,
  },
  "an any that reaches a type": {
    "stock.ts": stock,
    "main.ts": `import { Stock } from "./stock";
${begins}
const saved: any = JSON.parse("[]");
for (const item of saved) stock.add(item);
console.log(stock.value());
`,
  },
  "the same with the values checked and built anew": {
    "stock.ts": stock,
    "main.ts": `import { Stock, type Item } from "./stock";
function toItem(value: unknown): Item {
  if (typeof value !== "object" || value === null) throw new TypeError("not an item");
  const { sku, price, quantity } = value as Record<string, unknown>;
  if (typeof sku !== "string" || typeof price !== "number" || typeof quantity !== "number") throw new TypeError("not an item");
  return { sku, price, quantity };
}
${begins}
const saved: unknown = JSON.parse("[]");
if (!Array.isArray(saved)) throw new TypeError("not an array");
for (const value of saved) stock.add(toItem(value));
console.log(stock.value());
`,
  },
  "data from outside cast to a type": {
    "stock.ts": stock,
    "main.ts": `import { Stock, type Item } from "./stock";
${begins}
const saved = JSON.parse("[]") as Item[];
for (const item of saved) stock.add(item);
console.log(stock.value());
`,
  },
  "properties of an any": {
    "main.ts": `const body: any = JSON.parse('{"visits":3}');
console.log(body.visits, body.name);
`,
  },
  "a JavaScript file of the program": {
    "helper.js": `export function describe(job) {
  return job.id + ": " + job.state;
}
`,
    "main.ts": `import { describe } from "./helper.js";
class Job {
  id = 1;
  state = "queued";
}
console.log(describe(new Job()));
`,
  },
  "a class without a layout": {
    "main.ts": `class HttpError extends Error {
  status = 500;
}
console.log(new HttpError("x").status);
`,
  },
};

async function check(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDirWithBunTypes("aot-summary-line", files);
  await using proc = Bun.spawn({ cmd: [bunExe(), "check", "--aot", "--no-pretty", ...flags, "main.ts"], cwd: String(dir), env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr).split("\n");
  return { summary: lines.find(line => line.includes("of reads typed")), lines, exitCode };
}

const rest = "0 classes without a layout, 0 packages and 0 files untyped";

describe.concurrent("the share of typed reads counts reads through the program's own types", () => {
  test.each([
    ["a server that only reads its own type and what Bun provides", `aot: 100.0% of reads typed, 0 of 1 type open, ${rest}`],
    ["a class and a loop", `aot: 100.0% of reads typed, 0 of 1 type open, ${rest}`],
    ["an any that reaches a type", `aot: 66.7% of reads typed, 1 of 2 types open, ${rest} (--aot-explain lists them)`],
    ["the same with the values checked and built anew", `aot: 100.0% of reads typed, 0 of 2 types open, ${rest}`],
    ["data from outside cast to a type", `aot: 60.0% of reads typed, 0 of 1 type open, ${rest} (--aot-explain lists them)`],
    ["properties of an any", `aot: 0.0% of reads typed, 0 of 0 types open, ${rest} (--aot-explain lists them)`],
    ["a JavaScript file of the program", `aot: 0.0% of reads typed, 0 of 1 type open, 0 classes without a layout, 0 packages and 1 file untyped (--aot-explain lists them)`],
    ["a class without a layout", `aot: 0.0% of reads typed, 0 of 1 type open, 1 class without a layout, 0 packages and 0 files untyped (--aot-explain lists them)`],
  ])("%s", async (name, summary) => {
    expect(await check(programs[name])).toMatchObject({ summary, exitCode: 0 });
  }, 60_000);

  test.each(["a class and a loop"])("%s: --aot-explain finds nothing either", async name => {
    const { lines } = await check(programs[name], "--aot-explain");
    expect(lines).toContain("aot: there is no place where the compiler gives something up");
  }, 60_000);

  test.each(["an any that reaches a type", "data from outside cast to a type", "properties of an any", "a JavaScript file of the program", "a class without a layout"])("%s: --aot-explain names a place in the program", async name => {
    const { lines } = await check(programs[name], "--aot-explain");
    expect(lines.filter(line => /^ +\d+\. (main\.ts|stock\.ts|helper\.js):\d+:\d+ \[/.test(line))).not.toBeEmpty();
  }, 60_000);
});
