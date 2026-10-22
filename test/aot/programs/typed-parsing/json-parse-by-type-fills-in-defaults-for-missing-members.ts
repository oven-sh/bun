import type { Schema } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Server {
  host: string & Schema.Default<"localhost">;
  port: number & Schema.Default<8080>;
  secure: boolean & Schema.Default<false>;
  name: string;
}

function address(server: Server): string {
  return (server.secure ? "https://" : "http://") + server.host.toUpperCase() + ":" + (server.port + 1) + "/" + server.name;
}

const filled = JSON.parse<{ port: number & Schema.Default<8080> }>("{}").port === 8080;
console.log("filled in by the parser:", filled);
function withDefaults(text: string): Server {
  const server = JSON.parse<Server>(text);
  if (filled) return server;
  const whole: Server = { ...server };
  whole.host ??= "localhost";
  whole.port ??= 8080;
  whole.secure ??= false;
  return whole;
}

for (const text of ['{"name":"a"}', '{"name":"b","port":1}', '{"host":"h","name":"c"}', '{"name":"d","secure":true}', '{"port":0,"host":"","secure":false,"name":"e"}', '{"name":"f","port":-0}']) {
  attempt(text, () => {
    const server = withDefaults(text);
    return [address(server), server.host, server.port, server.secure, typeof server.port, Object.keys(server).sort(), "port" in server, Object.hasOwn(server, "host")];
  });
}
