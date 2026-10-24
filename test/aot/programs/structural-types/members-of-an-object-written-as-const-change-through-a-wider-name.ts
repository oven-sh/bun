function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

const settings = {
  port: 80,
  host: "local",
  secure: false,
  ratio: 0.5,
  big: 10n,
  nothing: null,
  nested: { depth: 1 },
  list: [1, 2, 3],
} as const;

function portOf(): 80 {
  return settings.port;
}
function isDefaultPort(): boolean {
  return settings.port === 80;
}
function hostLength(): number {
  return settings.host.length;
}
function secureText(): string {
  return settings.secure ? "secure" : "open";
}
function look(): unknown[] {
  return [settings.port, settings.host, settings.secure, settings.ratio, settings.big, settings.nothing, settings.nested.depth, settings.list[0], settings.list.length];
}

interface Wide {
  port: number;
  host: string;
  secure: boolean;
  ratio: number;
  big: bigint;
  nested: { depth: number };
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += portOf() + hostLength() + secureText().length + (isDefaultPort() ? 1 : 0);
console.log("2000 honest rounds", warm);
attempt("before", () => look());

const wide: Wide = settings;
wide.port = 8080.5;
attempt("the port", () => [portOf(), isDefaultPort(), settings.port + 1, typeof settings.port]);
wide.host = "elsewhere.example";
attempt("the host", () => [settings.host, hostLength(), settings.host === "local"]);
wide.secure = true;
attempt("secure", () => [settings.secure, secureText(), !settings.secure]);
wide.ratio = 3;
wide.big = 2n ** 70n;
attempt("the ratio and the bigint", () => [settings.ratio, settings.ratio * 2, settings.big, settings.big === 10n, settings.big + 1n]);
wide.nested.depth = -0;
attempt("nested", () => [settings.nested.depth, 1 / settings.nested.depth]);
wide.nested = { depth: 7 };
attempt("nested, replaced", () => settings.nested.depth);
Reflect.set(settings.list, 0, "first");
Reflect.set(settings.list, "length", 1);
attempt("the list", () => [settings.list[0], settings.list[2], settings.list.length, settings.list]);
Reflect.set(settings, "nothing", 0);
attempt("nothing", () => [settings.nothing, settings.nothing === null, settings.nothing ?? "default"]);
Reflect.deleteProperty(settings, "port");
attempt("the port is deleted", () => [portOf(), isDefaultPort(), Object.keys(settings)]);
attempt("after", () => look());
