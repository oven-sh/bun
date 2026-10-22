interface Config {
  port: number;
  host: string;
}

class Unavailable extends Error {}

const log: string[] = [];

const throwing: Config = {
  get port(): number {
    log.push("port");
    throw new Unavailable("port");
  },
  get host(): string {
    log.push("host");
    throw new RangeError("host");
  },
};

const second: Config = {
  port: 80,
  get host(): string {
    log.push("host");
    throw new Unavailable("host");
  },
};

class Lazy {
  get port(): number {
    log.push("lazy port");
    throw new SyntaxError("port");
  }
  host = "lazy";
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()) + " [" + log.join() + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join() + "]");
  }
  log.length = 0;
}

function address(c: Config): string {
  return c.host + ":" + c.port;
}

function portFirst(c: Config): string {
  return c.port + "@" + c.host;
}

function guarded(c: Config): string {
  let port = -1;
  let host = "none";
  try {
    port = c.port;
  } catch {
    log.push("caught port");
  }
  try {
    host = c.host;
  } catch {
    log.push("caught host");
  } finally {
    log.push("finally");
  }
  return host + ":" + port;
}

function dropped(c: Config): string {
  c.port;
  return "survived";
}

const table: [string, Config][] = [
  ["plain", { port: 1, host: "plain" }],
  ["both throw", throwing],
  ["host throws", second],
  ["a getter of a class throws", new Lazy()],
];

for (const [label, c] of table) {
  attempt(label + ", host first", () => address(c));
  attempt(label + ", port first", () => portFirst(c));
  attempt(label + ", guarded", () => guarded(c));
  attempt(label + ", value dropped", () => dropped(c));
  attempt(label + ", json", () => JSON.stringify(c));
  attempt(label + ", spread", () => JSON.stringify({ ...c }));
  attempt(label + ", keys", () => Object.keys(c).join());
  attempt(label + ", values", () => Object.values(c).join());
  attempt(label + ", pattern", () => (({ host, port }: Config) => host + port)(c));
  attempt(label + ", pattern with a default parameter", () => ((config: Config, port = config.port) => port)(c));
  attempt(label + ", template", () => `${c.port}/${c.host}`);
  attempt(label + ", argument order", () => [log.push("before"), c.port, log.push("after")].length);
}

const plain: Config = { port: 1, host: "plain" };
let total = 0;
for (let i = 0; i < 2000; i++) total += address(plain).length;
console.log("2000 honest: " + total);
attempt("then the throwing one", () => address(throwing));
attempt("then plain", () => address(plain));

let reached = 0;
try {
  for (const c of [plain, plain, second, plain]) {
    address(c);
    reached++;
  }
} catch (error) {
  console.log("the loop stopped after " + reached + " with " + (error instanceof Unavailable));
}

export {};
