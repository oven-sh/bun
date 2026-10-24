function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Formatter = ((n: number) => string) | string | null;
type Listener = (() => void) | { handle(): void };

function format(f: Formatter, n: number): string {
  if (typeof f === "function") return f(n);
  if (f === null) return String(n);
  return f + n;
}

const log: string[] = [];
function notify(l: Listener): void {
  if (typeof l === "function") l();
  else l.handle();
}
function notifyByMember(l: Listener): void {
  if ("handle" in l) l.handle();
  else l();
}

function withCallback(n: number, done?: (result: number) => void): number {
  const result = n * 2;
  done?.(result);
  return result;
}
function withDefault(n: number, map: (n: number) => number = x => x + 1): number {
  return map(n);
}

show("a function", () => format(n => "<" + n + ">", 1));
show("a string", () => format("#", 1));
show("null", () => format(null, 1));
show("a built-in", () => format(String, 1));
show("a bound function", () => format(String.bind(null), 1));
show("a proxy", () => format(new Proxy((n: number) => "proxied " + n, {}), 1));

const both = Object.assign(() => { log.push("called"); }, { handle() { log.push("handled"); } });
notify(() => { log.push("plain function"); });
notify({ handle() { log.push("plain object"); } });
notify(both);
notifyByMember(() => { log.push("plain function"); });
notifyByMember({ handle() { log.push("plain object"); } });
notifyByMember(both);
class Handler {
  handle(): void {
    log.push("class instance");
  }
  static handle(): void {
    log.push("static side");
  }
}
notify(new Handler());
notifyByMember(new Handler());
show("a class with a static handle, by typeof", () => notify(Handler));
show("a class with a static handle, by member", () => notifyByMember(Handler));
show("log", () => log.join());

let seen = -1;
show("no callback", () => withCallback(2));
show("undefined", () => withCallback(2, undefined));
show("a callback", () => withCallback(2, r => { seen = r; }) + " " + seen);
show("default", () => withDefault(1));
show("undefined takes the default", () => withDefault(1, undefined));
show("given", () => withDefault(1, x => x * 10));
show("a built-in given", () => withDefault(-1, Math.abs));

let total = 0;
for (let i = 0; i < 2000; i++) total += withCallback(1, i % 2 === 0 ? undefined : r => { total += r; });
show("2000 calls, every other one with a callback", () => total);
