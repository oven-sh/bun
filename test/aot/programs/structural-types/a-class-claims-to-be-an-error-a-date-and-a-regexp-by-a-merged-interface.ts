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

interface Failure extends Error {}
class Failure {
  code: number = 1;
}

interface Stamp extends Date {}
class Stamp {
  id: number = 2;
}

interface Pattern extends RegExp {}
class Pattern {
  id: number = 3;
}

function messageOf(error: Error): string {
  return error.message;
}

function messageLength(error: Error): number {
  return error.message.length;
}

function timeOf(date: Date): number {
  return date.getTime();
}

function matches(pattern: RegExp, s: string): boolean {
  return pattern.test(s);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += messageOf(new Error("ab")).length + messageLength(new RangeError("c")) + timeOf(new Date(i)) + (matches(/a/, "a") ? 1 : 0);
show("2000 honest rounds", () => warm);

const failure = new Failure();
show("message", () => messageOf(failure));
show("the length of the message", () => messageLength(failure));
show("its name", () => failure.name);
show("stack", () => failure.stack);
show("instanceof Error", () => failure instanceof Error);
show("toString", () => failure.toString());
show("thrown and caught", () => {
  try {
    throw failure;
  } catch (caught) {
    return [caught === failure, caught instanceof Error, typeof caught];
  }
});
show("thrown out of the function", () => {
  throw failure;
});
show("as a cause", () => new Error("outer", { cause: failure }).cause === failure);
show("keys", () => Object.keys(failure));

const stamp = new Stamp();
show("getTime", () => timeOf(stamp));
show("typeof getTime", () => typeof stamp.getTime);
show("the real getTime on it", () => Date.prototype.getTime.call(stamp));
show("valueOf is typed number", () => typeof stamp.valueOf());
show("new Date from it", () => new Date(stamp).getTime());
show("JSON", () => JSON.stringify(stamp));

const pattern = new Pattern();
show("test", () => matches(pattern, "a"));
show("source", () => pattern.source);
show("lastIndex", () => pattern.lastIndex);
show("lastIndex plus one", () => pattern.lastIndex + 1);
show("flags", () => pattern.flags);
show("replace with it", () => "[object Object]!".replace(pattern, "x"));
show("split with it", () => "a[object Object]b".split(pattern));
show("match with it", () => "abc".match(pattern));
show("new RegExp from it", () => new RegExp(pattern).source);
show("honest again", () => [messageOf(new Error("m")), timeOf(new Date(5)), matches(/a/, "b")]);
