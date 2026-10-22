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

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      A_PORT_NOBODY_EVER_SET: string;
      A_MODE_NOBODY_EVER_SET: "fast" | "slow";
    }
  }
  interface ImportMeta {
    buildNumber: number;
    channel: string;
    reload(): void;
  }
}

function lengthOf(s: string): number {
  return s.length;
}

function portNumber(): number {
  return Number(process.env.A_PORT_NOBODY_EVER_SET);
}

show("the variable", () => [process.env.A_PORT_NOBODY_EVER_SET, typeof process.env.A_PORT_NOBODY_EVER_SET]);
show("its length", () => process.env.A_PORT_NOBODY_EVER_SET.length);
show("given to a typed function", () => lengthOf(process.env.A_PORT_NOBODY_EVER_SET));
show("as a number", () => portNumber());
show("parseInt", () => parseInt(process.env.A_PORT_NOBODY_EVER_SET, 10));
show("followed by a string", () => process.env.A_PORT_NOBODY_EVER_SET + "!");
show("or a default", () => process.env.A_PORT_NOBODY_EVER_SET ?? "8080");
show("in", () => "A_PORT_NOBODY_EVER_SET" in process.env);
show("one of two", () => {
  switch (process.env.A_MODE_NOBODY_EVER_SET) {
    case "fast":
      return "fast";
    case "slow":
      return "slow";
    default:
      return "neither";
  }
});
show("if it is not fast", () => (process.env.A_MODE_NOBODY_EVER_SET === "fast" ? "fast" : "so it is slow"));

process.env.A_PORT_NOBODY_EVER_SET = "81";
show("after a store", () => [process.env.A_PORT_NOBODY_EVER_SET, lengthOf(process.env.A_PORT_NOBODY_EVER_SET), portNumber()]);
const optional: { A_PORT_NOBODY_EVER_SET?: string } = process.env;
delete optional.A_PORT_NOBODY_EVER_SET;
show("after it is deleted", () => [process.env.A_PORT_NOBODY_EVER_SET, portNumber()]);

show("import.meta: the number", () => [import.meta.buildNumber, typeof import.meta.buildNumber, import.meta.buildNumber + 1]);
show("import.meta: the text", () => import.meta.channel);
show("import.meta: the length of the text", () => import.meta.channel.length);
show("import.meta: the method", () => import.meta.reload());
show("import.meta: in", () => "buildNumber" in import.meta);
import.meta.buildNumber = 12;
show("import.meta: after a store", () => [import.meta.buildNumber, import.meta.buildNumber + 1]);

export {};
