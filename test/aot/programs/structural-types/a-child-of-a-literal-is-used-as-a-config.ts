function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

interface Config {
  port: number;
  ratio: number;
  host: string;
  secure: boolean;
  paths: string[];
  limits: { max: number };
  note?: string;
}

function config(port: number): Config {
  return { port, ratio: 0.5, host: "localhost", secure: true, paths: ["/"], limits: { max: 10 } };
}

function child(source: Config): Config {
  return Object.create(source);
}

const uses: [string, (c: Config) => unknown][] = [
  ["typeof", c => typeof c],
  ["port + 1", c => c.port + 1],
  ["ratio * 2", c => c.ratio * 2],
  ["port | 0", c => c.port | 0],
  ["length of the host", c => c.host.length],
  ["the host and the port", c => c.host + ":" + c.port],
  ["secure", c => (c.secure ? "yes" : "no")],
  ["exactly true", c => c.secure === true],
  ["paths", c => [c.paths.length, c.paths[0]]],
  ["the limit", c => c.limits.max + 1],
  ["note", c => c.note ?? "no note"],
  ["kinds", c => [typeof c.port, typeof c.ratio, typeof c.host, typeof c.secure, typeof c.paths, typeof c.limits, typeof c.note]],
  ["a store to the port", c => {
    c.port = 81.5;
    return [c.port, c.port + c.ratio];
  }],
  ["port++", c => {
    c.port++;
    return c.port;
  }],
  ["a store to the host", c => {
    c.host = "example";
    return c.host.length;
  }],
  ["a store to the note", c => {
    c.note = "noted";
    return [c.note, Object.keys(c)];
  }],
  ["delete the note", c => [delete c.note, "note" in c]],
  ["a pushed path", c => c.paths.push("/more")],
  ["a store to the limit", c => {
    c.limits.max = 20;
    return c.limits.max;
  }],
  ["in", c => ["port" in c, "note" in c, "missing" in c]],
  ["own", c => [Object.hasOwn(c, "port"), Object.hasOwn(c, "host")]],
  ["keys", c => Object.keys(c)],
  ["JSON", c => JSON.stringify(c)],
  ["for-in", c => {
    const names: string[] = [];
    for (const name in c) names.push(name);
    return names;
  }],
  ["a pattern", c => {
    const { port, host, limits: { max } } = c;
    return [port, host, max];
  }],
  ["a spread", c => ({ ...c, port: 1 })],
  ["prototype", c => Object.getPrototypeOf(c) === Object.prototype],
];

function address(c: Config): string {
  return c.host + ":" + c.port;
}

function budget(c: Config): number {
  return c.limits.max * c.ratio + c.port;
}

function move(c: Config, port: number): number {
  c.port = port;
  return c.port;
}

class Server {
  name = "server";
  config: Config;
  started = 0.5;
  constructor(config: Config) {
    this.config = config;
  }
  address(): string {
    return this.config.host + ":" + this.config.port;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = config(i);
  warm += address(honest).length + budget(honest) + move(honest, 1) + new Server(honest).address().length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(config(i));
console.log("after the honest configs", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(child(config(80))));
}
{
  const source = config(80);
  const made = child(source);
  attempt("typed functions", () => [address(made), budget(made), move(made, 8080)]);
  attempt("in a field", () => {
    const server = new Server(made);
    return [server.name, server.address(), server.started];
  });
  attempt("among honest configs", () => [config(1), made, config(2)].map(budget));
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.port, source.host, source.paths, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.port = 100;
    source.paths.push("/late");
    return [made.port, made.paths];
  });
}
attempt("honest again", () => [address(config(80)), budget(config(80)), move(config(80), 1)]);
