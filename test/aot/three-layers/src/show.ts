import { test } from "../../harness/declare";

export function show(value: unknown, depth: number = 0, seen: unknown[] = []): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  switch (typeof value) {
    case "number": return Object.is(value, -0) ? "-0" : String(value);
    case "string": return JSON.stringify(value);
    case "boolean": return String(value);
    case "bigint": return value + "n";
    case "symbol": return String(value);
    case "function": return "[function " + value.name + "/" + value.length + "]";
  }
  const object = value as object;
  if (seen.includes(object)) return "[cycle]";
  if (depth > 5) return "[deep]";
  const next = [...seen, object];
  const inner = (each: unknown) => show(each, depth + 1, next);
  const proto = Object.getPrototypeOf(object);
  const name: string = proto === null ? "null-proto" : typeof proto.constructor === "function" ? proto.constructor.name : "?";
  if (object instanceof Error) return name + "(" + object.name + ": " + object.message + (object.cause !== undefined ? ", cause " + inner(object.cause) : "") + ownText(object, inner, ["stack", "message", "cause", "line", "column", "sourceURL", "originalLine", "originalColumn"]) + ")";
  if (Array.isArray(object)) {
    const parts: string[] = [];
    for (let i = 0; i < object.length; i++) parts.push(i in object ? inner(object[i]) : "hole");
    return (name === "Array" ? "" : name) + "[" + parts.join(", ") + "]";
  }
  if (object instanceof Map) return name + "{" + [...object].map(([k, v]) => inner(k) + " => " + inner(v)).join(", ") + "}";
  if (object instanceof Set) return name + "{" + [...object].map(inner).join(", ") + "}";
  if (object instanceof Date) return name + "(" + object.toISOString() + ")";
  if (object instanceof RegExp) return name + "(" + String(object) + ")";
  if (ArrayBuffer.isView(object)) return name + "<" + Array.from(new Uint8Array(object.buffer, object.byteOffset, object.byteLength)).join(" ") + ">";
  if (object instanceof Promise) return name + "(promise)";
  return (name === "Object" ? "" : name) + "{" + ownText(object, inner, []).replace(/^, /, "") + "}";
}

function ownText(object: object, inner: (each: unknown) => string, without: string[]): string {
  let text = "";
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key === "string" && without.includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    const marks = (descriptor.enumerable ? "" : "~") + ("value" in descriptor ? (descriptor.writable ? "" : "!") : "");
    text += ", " + marks + String(key) + ": " + ("value" in descriptor ? inner(descriptor.value) : "[" + (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "") + "]");
  }
  return text;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

// Caches are filled at the second or third miss, so each body runs several times. The first answer is printed, and a hash of all of them.
export function check(file: string, name: string, f: () => unknown): void {
  test(name, async () => {
    const all: string[] = [];
    for (let turn = 0; turn < 7; turn++) {
      let out: string;
      try {
        out = show(await f());
      } catch (error) {
        out = "THROWS " + show(error);
      }
      all.push(out);
    }
    console.log("RESULT|" + file + "|" + name + "|" + hash(all.join("\n")) + "|" + all[0]);
    if (typeof process !== "undefined" && process.env.BORDER_ALL) all.forEach((out, turn) => console.log("TURN|" + file + "|" + name + "|" + turn + "|" + out));
  });
}
