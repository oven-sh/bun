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
  var DEBUG_FLAG: false;
  var RELEASE_FLAG: true;
  var API_LEVEL: 3;
  var CHANNEL_NAME: "stable";
  var NOTHING_YET: null;
  var WHICH_SIDE: "left" | "right";
  var NEVER_SET_FLAG: true;
}

const wide: { DEBUG_FLAG: boolean; RELEASE_FLAG: boolean; API_LEVEL: number; CHANNEL_NAME: string; NOTHING_YET: null | number; WHICH_SIDE: string } = globalThis;

function debugWord(): string {
  if (DEBUG_FLAG) return "debugging";
  return "quiet";
}

function releaseWord(): string {
  return RELEASE_FLAG ? "release" : "not a release";
}

function nextLevel(): number {
  return API_LEVEL + 1;
}

function isStable(): boolean {
  return CHANNEL_NAME === "stable";
}

function sideWord(): string {
  switch (WHICH_SIDE) {
    case "left":
      return "it is left";
    case "right":
      return "it is right";
  }
}

function all(label: string): void {
  show(label + ": false", () => [DEBUG_FLAG, debugWord(), !DEBUG_FLAG, DEBUG_FLAG === false, globalThis.DEBUG_FLAG]);
  show(label + ": true", () => [RELEASE_FLAG, releaseWord(), RELEASE_FLAG === true, RELEASE_FLAG || "the right side"]);
  show(label + ": the number", () => [API_LEVEL, nextLevel(), API_LEVEL === 3, ["a", "b", "c", "d", "e"][API_LEVEL]]);
  show(label + ": the text", () => [CHANNEL_NAME, isStable(), CHANNEL_NAME.length, `on ${CHANNEL_NAME}`]);
  show(label + ": null", () => [NOTHING_YET, NOTHING_YET === null, NOTHING_YET ?? "default"]);
  show(label + ": one of two", () => [WHICH_SIDE, sideWord(), WHICH_SIDE === "left" ? "left" : "so it is right"]);
}

globalThis.DEBUG_FLAG = false;
globalThis.RELEASE_FLAG = true;
globalThis.API_LEVEL = 3;
globalThis.CHANNEL_NAME = "stable";
globalThis.NOTHING_YET = null;
globalThis.WHICH_SIDE = "left";
all("honest");

let rounds = 0;
for (let i = 0; i < 2000; i++) if (debugWord() === "quiet" && nextLevel() === 4 && isStable()) rounds++;
show("2000 honest rounds", () => rounds);

wide.DEBUG_FLAG = true;
wide.RELEASE_FLAG = false;
wide.API_LEVEL = 4;
wide.CHANNEL_NAME = "beta";
wide.NOTHING_YET = 0;
wide.WHICH_SIDE = "middle";
all("through the wider view");

show("the one nobody sets: typeof", () => typeof NEVER_SET_FLAG);
show("the one nobody sets: through globalThis", () => [globalThis.NEVER_SET_FLAG, globalThis.NEVER_SET_FLAG === true, globalThis.NEVER_SET_FLAG ? "yes" : "no"]);
show("the one nobody sets: by name", () => (NEVER_SET_FLAG ? "yes" : "no"));

export {};
