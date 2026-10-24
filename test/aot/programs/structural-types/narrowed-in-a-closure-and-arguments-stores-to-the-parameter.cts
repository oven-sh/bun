function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

say("strict", (function (this: unknown) {
  return this === undefined;
})());

function inAClosure(v: number | string): () => number {
  if (typeof v === "string") v = v.length;
  const read = () => v + 1;
  arguments[0] = "text";
  return read;
}

function straight(v: number | string): unknown {
  if (typeof v === "number") {
    arguments[0] = "text";
    return v + 1;
  }
  return "other";
}

function throughAHelper(v: number | string): unknown {
  if (typeof v === "number") {
    overwrite(arguments);
    return v + 1;
  }
  return "other";
}

function overwrite(list: IArguments): void {
  list[0] = "text";
}

class Leaf {
  weight = 7;
}

function cleared(l: Leaf | null): unknown {
  if (l !== null) {
    arguments[0] = null;
    try {
      return l.weight;
    } catch (error) {
      return error instanceof TypeError ? "a TypeError" : "another error";
    }
  }
  return "other";
}

function aLiteral(mode: "on" | "off"): unknown {
  if (mode === "on") {
    arguments[0] = "off";
    return mode;
  }
  return "other";
}

function notPassed(v?: number | string): unknown {
  if (v === undefined) {
    arguments[0] = "text";
    return v;
  }
  return "other";
}

say("in a closure", inAClosure(1)());
say("in a closure, from a string", inAClosure("ab")());
say("straight", straight(1));
say("through a helper", throughAHelper(1));
say("cleared", cleared(new Leaf()));
say("a literal type", aLiteral("on"));
say("not passed", notPassed());
let sum = 0;
for (let i = 0; i < 2000; i++) sum += String(straight(i)).length;
say("2000 rounds", sum);
