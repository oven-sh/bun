function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

function inAClosure(v: number | string): () => unknown {
  if (typeof v === "string") v = v.length;
  const read = () => v + 1;
  eval("v = 'text'");
  return read;
}

function straight(v: number | string): unknown {
  if (typeof v === "number") {
    eval("v = 'text'");
    return v + 1;
  }
  return "other";
}

function aConstantCondition(v: number | string): unknown {
  const isNumber = typeof v === "number";
  eval("v = 'text'");
  if (isNumber) return v + 1;
  return "other";
}

class Leaf {
  weight = 7;
}

function cleared(l: Leaf | null): unknown {
  if (l !== null) {
    eval("l = null");
    try {
      return l.weight;
    } catch (error) {
      return error instanceof TypeError ? "a TypeError" : "another error";
    }
  }
  return "other";
}

function aLocal(): unknown {
  let mode: "on" | "off" = "on";
  eval("mode = 'off'");
  return mode;
}

say("in a closure", inAClosure(1)());
say("straight", straight(1));
say("a condition kept in a constant", aConstantCondition(1));
say("cleared", cleared(new Leaf()));
say("a local typed by its last store", aLocal());
