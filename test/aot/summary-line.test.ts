// The line that ends a build says how many of the program's property accesses are one load or store. They are counted in the
// optimized program, so no count is written down here: a test says whether its program has typed and untyped accesses,
// and computes the line from the numbers of `--explain=json`.
// The read of `console.log` is one of the typed accesses, so only a program that prints nothing has none. An object that never
// leaves its function is not allocated. So a program that is to be typed keeps its objects in an array.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { parseExplainLines, type ExplainNumbers } from "./explain/explain-report";
import { countAccesses } from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

type Files = Record<string, string>;

interface Program {
  files: Files;
  /** Left out where it depends on what the optimizer removes. */
  hasTyped?: boolean;
  hasUntyped: boolean;
}

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

const ends = `const value = stock.value();
console.log(value);
`;

const savedText = `'[{"sku":"B-2","price":10,"quantity":3}]'`;

const programs: Record<string, Program> = {
  "a class and a loop": {
    hasTyped: true,
    hasUntyped: false,
    files: {
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
for (let id = 0; id < 10; id++) {
  const account = new Account(id, id % 3);
  accounts.push(account);
}
const sum = total(accounts);
console.log(sum);
`,
    },
  },
  "objects of a class behind an any": {
    hasTyped: true,
    hasUntyped: false,
    files: {
      "main.ts": `class Account {
  id = 1;
  balance = 2;
}
const accounts: any[] = [];
for (let id = 0; id < 10; id++) {
  const account = new Account();
  accounts.push(account);
}
let sum = 0;
for (const account of accounts) sum += account.balance;
console.log(sum);
`,
    },
  },
  "a JavaScript file of the program": {
    hasTyped: true,
    hasUntyped: false,
    files: {
      "helper.js": `export function describe(jobs) {
  let text = "";
  for (const job of jobs) text += job.id + ": " + job.state + "\\n";
  return text;
}
`,
      "main.ts": `import { describe } from "./helper.js";
class Job {
  id = 1;
  state = "queued";
}
const jobs = [new Job(), new Job()];
const text = describe(jobs);
console.log(text);
`,
    },
  },
  "properties of parsed data": {
    hasUntyped: true,
    files: {
      "main.ts": `const body: any = JSON.parse('{"visits":3}');
const visits = body.visits;
const visitor = body.name;
console.log(visits, visitor);
`,
    },
  },
  "parsed data that reaches a type": {
    hasUntyped: true,
    files: {
      "stock.ts": stock,
      "main.ts": `import { Stock } from "./stock";
${begins}
const saved: any = JSON.parse(${savedText});
for (const item of saved) stock.add(item);
${ends}`,
    },
  },
  "parsed data cast to a type": {
    hasUntyped: true,
    files: {
      "stock.ts": stock,
      "main.ts": `import { Stock, type Item } from "./stock";
${begins}
const saved = JSON.parse(${savedText}) as Item[];
for (const item of saved) stock.add(item);
${ends}`,
    },
  },
  "parsed data checked and built anew: only its own properties are looked up": {
    hasTyped: true,
    hasUntyped: true,
    files: {
      "stock.ts": stock,
      "main.ts": `import { Stock, type Item } from "./stock";
function toItem(value: unknown): Item {
  if (typeof value !== "object" || value === null) throw new TypeError("not an item");
  const { sku, price, quantity } = value as Record<string, unknown>;
  if (typeof sku !== "string" || typeof price !== "number" || typeof quantity !== "number") throw new TypeError("not an item");
  return { sku, price, quantity };
}
${begins}
const saved: unknown = JSON.parse(${savedText});
if (!Array.isArray(saved)) throw new TypeError("not an array");
for (const value of saved) {
  const item = toItem(value);
  stock.add(item);
}
${ends}`,
    },
  },
  "a class that extends a class of the runtime": {
    hasUntyped: true,
    files: {
      "main.ts": `class HttpError extends Error {
  status = 500;
}
const failure = new HttpError("x");
const code = failure.status;
console.log(code);
`,
    },
  },
  "objects of types that are imported from bun": {
    hasUntyped: true,
    files: {
      "main.ts": `import type { BunRequest } from "bun";
export function session(request: BunRequest): string | null {
  return request.cookies.get("sid") ?? request.headers.get("x-session") ?? request.params.id ?? null;
}
console.log(session, process.env.PORT);
`,
    },
  },
  "a server": {
    hasUntyped: true,
    files: {
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
  },
  "no property access": {
    hasTyped: false,
    hasUntyped: false,
    files: {
      "main.ts": `const greeting = "hello";
export default greeting;
`,
    },
  },
};

const hint = "Untyped code works, but runs slower. Run with --explain to see what to fix.";
const nothingToExplain = "note: Every property access is typed. Nothing to fix.";
const summaryLine = /^([\d.]+% of property accesses are one load: |Untyped code works, but runs slower\. Run)/;
const entryLine = /^note: \d+\. [a-z-]+: /;
const placeInProgram = /^ +at (.*[\\/])?(main\.ts|stock\.ts|helper\.js):\d+:\d+$/;
const buildTimeout = 300_000;

async function check(files: Files, ...flags: string[]) {
  using dir = tempDirWithBunTypes("aot-summary-line", files);
  const command = [bunExe(), "check", "--aot", "--no-pretty", ...flags, "main.ts"];
  const { stdout, stderr, exitCode, signal } = await spawned(command, String(dir), { ...bunEnv, NO_COLOR: "1" });
  const said = exitCode === 0 ? "" : stdout + stderr;
  expect({ exitCode, signal, said }).toEqual({ exitCode: 0, signal: null, said: "" });
  const lines = stderr.split("\n");
  return { stdout, lines, summary: lines.filter(line => summaryLine.test(line)) };
}

async function numbersOf(files: Files): Promise<ExplainNumbers> {
  return parseExplainLines((await check(files, "--explain=json")).stdout).numbers;
}

const count = (number: number) => number.toLocaleString("en-US");

function summaryOf({ accesses }: ExplainNumbers, hasTextReport: boolean) {
  const [typed, total] = [accesses.free, countAccesses(accesses)];
  if (total === 0) return [];
  const tenths = Math.max(Math.floor((typed * 1000) / total), typed > 0 ? 1 : 0);
  const columns = `${count(accesses.free)} free, ${count(accesses.tested)} tested, ${count(accesses.byName)} by name`;
  const line = `${tenths / 10}% of property accesses are one load: ${columns} (${count(total)})`;
  return tenths < 950 && !hasTextReport ? [hint, line] : [line];
}

describe.concurrent("typed percentage", () => {
  test.each(Object.keys(programs))(
    "%s",
    name =>
      slot(async () => {
        const { files, ...expected } = programs[name]!;
        const numbers = await numbersOf(files);
        const typed = numbers.accesses.free;
        expect({ hasTyped: typed > 0, hasUntyped: typed < countAccesses(numbers.accesses) }).toMatchObject(expected);
        expect(countAccesses(numbers.dependencyAccesses)).toBe(0);
        expect((await check(files)).summary).toEqual(summaryOf(numbers, false));

        const { lines, summary } = await check(files, "--explain");
        expect(summary).toEqual(summaryOf(numbers, true));
        expect(lines.includes(nothingToExplain)).toBe(!expected.hasUntyped);
        expect({
          hasEntry: lines.some(line => entryLine.test(line)),
          hasEntryInProgram: lines.some(line => placeInProgram.test(line)),
        }).toEqual({ hasEntry: expected.hasUntyped, hasEntryInProgram: expected.hasUntyped });
      }),
    buildTimeout,
  );
});
