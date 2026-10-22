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

namespace Config {
  export let port: number;
  export let host: string;
  export let flags: string[];
  export let handler: (n: number) => number;
  export var legacy: number;
  export let ready: boolean;
  export const fixed: number = 1;
  export function nextPort(): number {
    return port + 1;
  }
  export function address(): string {
    return host + ":" + port;
  }
  export function setPort(n: number): void {
    port = n;
  }
}

function portOf(): number {
  return Config.port;
}

show("the number", () => [Config.port, typeof Config.port, portOf()]);
show("the number plus one", () => [Config.port + 1, portOf() + 1, Config.nextPort()]);
show("the number as a whole number", () => Config.port | 0);
show("the text", () => [Config.host, typeof Config.host]);
show("the length of the text", () => Config.host.length);
show("both from inside", () => Config.address());
show("the list", () => Config.flags);
show("a push into the list", () => Config.flags.push("x"));
show("the function called", () => Config.handler(1));
show("the var", () => [Config.legacy, Config.legacy + 1]);
show("the boolean", () => [Config.ready, Config.ready === false, Config.ready ? "yes" : "no"]);
show("in", () => ["port" in Config, "legacy" in Config, "fixed" in Config]);
show("keys", () => Object.keys(Config));
show("JSON", () => JSON.stringify(Config));

Config.port = 80;
show("stored from outside", () => [Config.port, portOf(), Config.nextPort(), Object.keys(Config)]);
Config.setPort(81.5);
show("stored from inside", () => [Config.port, portOf(), Config.nextPort()]);
Config.host = "local";
show("the text stored", () => [Config.address(), Config.host.length, Object.keys(Config)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += portOf() + Config.nextPort();
show("2000 reads", () => sum);

const optional: { port?: number } = Config;
delete optional.port;
show("deleted through an optional view", () => [Config.port, portOf(), Config.nextPort(), Object.keys(Config)]);
