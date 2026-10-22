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

declare const DEBUG_MODE: false;
declare const RELEASE_MODE: true;
declare const API_LEVEL: 3;
declare const CHANNEL: "stable";
declare const NOTHING: null;
declare const ABSENT: undefined;
declare const SIDE: "left" | "right";

Object.assign(globalThis, {
  DEBUG_MODE: true,
  RELEASE_MODE: false,
  API_LEVEL: 4,
  CHANNEL: "beta",
  NOTHING: 0,
  ABSENT: "here",
  SIDE: "middle",
});

function debugWord(): string {
  if (DEBUG_MODE) return "debugging";
  return "quiet";
}

function releaseWord(): string {
  return RELEASE_MODE ? "release" : "not a release";
}

function nextLevel(): number {
  return API_LEVEL + 1;
}

function sideWord(): string {
  switch (SIDE) {
    case "left":
      return "it is left";
    case "right":
      return "it is right";
  }
}

show("false: read", () => DEBUG_MODE);
show("false: as a condition", () => debugWord());
show("false: not", () => !DEBUG_MODE);
show("false: is it what its type says", () => DEBUG_MODE === false);
show("false: and", () => DEBUG_MODE && "the right side");
show("true: read", () => RELEASE_MODE);
show("true: as a condition", () => releaseWord());
show("true: or", () => RELEASE_MODE || "the right side");
show("the number: read", () => API_LEVEL);
show("the number: plus one", () => [API_LEVEL + 1, nextLevel()]);
show("the number: is it what its type says", () => API_LEVEL === 3);
show("the number: as an index", () => ["a", "b", "c", "d", "e"][API_LEVEL]);
show("the text: read", () => CHANNEL);
show("the text: is it what its type says", () => CHANNEL === "stable");
show("the text: length", () => CHANNEL.length);
show("the text: in a template", () => `on ${CHANNEL}`);
show("null: read", () => NOTHING);
show("null: is it what its type says", () => NOTHING === null);
show("null: or a default", () => NOTHING ?? "default");
show("undefined: read", () => ABSENT);
show("undefined: is it what its type says", () => ABSENT === undefined);
show("undefined: or a default", () => ABSENT ?? "default");
show("undefined: typeof", () => typeof ABSENT);
show("one of two: read", () => SIDE);
show("one of two: a switch over both", () => sideWord());
show("one of two: if it is not left", () => (SIDE === "left" ? "left" : "so it is right"));

let debugging = 0;
for (let i = 0; i < 2000; i++) if (debugWord() === "debugging" && nextLevel() === 5) debugging++;
show("2000 rounds", () => debugging);
