// An object is made in either arm of a test, with a text of the same form in one field: a constant and a number. The text grows inside a try, and the catch reads
// the field: as it was made where the call in front of the append throws, grown where the call behind it does.
type Row = { n: number; t: string };

function refuse(at: number, when: number): void {
  if (at % 4 === when) throw new Error("refused " + at);
}

function objects(at: number): number | string {
  let it: Row;
  if (at % 3) it = { n: at, t: "t" + at };
  else it = { n: at + 10, t: "t" + (at + 10) };
  try {
    it.t += "y";
    refuse(at, 3);
    return it.n;
  } catch {
    return it.t;
  }
}

function objectsRefusedFirst(at: number): number | string {
  let it: Row;
  if (at % 3) it = { n: at, t: "t" + at };
  else it = { n: at + 10, t: "t" + (at + 10) };
  try {
    refuse(at, 2);
    it.t += "y";
    refuse(at, 3);
    return it.n;
  } catch {
    return it.t;
  }
}

function pairs(at: number): number | string {
  const it: [number, string] = at % 2 ? [at, "t" + at] : [at + 10, "t" + (at + 10)];
  try {
    it[1] += "y";
    refuse(at, 1);
    return it[0];
  } catch {
    return it[1].length + it[0] + it[1];
  }
}

function leftByFinally(at: number, seen: (number | string)[]): void {
  let it: Row;
  if (at % 3) it = { n: at, t: "t" + at };
  else it = { n: at + 10, t: "t" + (at + 10) };
  try {
    it.t += "y";
    refuse(at, 0);
    seen.push(it.n);
  } finally {
    seen.push(it.t);
  }
}

class Line {
  constructor(
    public n: number,
    public t: string,
  ) {}
}

function instances(at: number): number | string {
  const it = at % 2 ? new Line(at, "t" + at) : new Line(at + 10, "t" + (at + 10));
  try {
    it.t += "y";
    refuse(at, 2);
    return it.n;
  } catch {
    return it.t;
  }
}

function oneTryInAnother(at: number): string {
  let it: Row;
  if (at % 3) it = { n: at, t: "t" + at };
  else it = { n: at + 10, t: "t" + (at + 10) };
  try {
    it.t += "x";
    try {
      it.t += "y";
      refuse(at, 1);
    } catch {
      it.t += "!";
      refuse(at + 1, 2);
    }
    refuse(at, 3);
    return "left " + it.n;
  } catch {
    return "outer " + it.t;
  }
}

function* steps(at: number): Generator<string, void, unknown> {
  const it = at % 2 ? { t: "t" + at } : { t: "t" + (at + 10) };
  try {
    it.t += "y";
    yield "in";
    refuse(at, 1);
  } catch {
    yield it.t;
  }
}

async function later(at: number): Promise<string> {
  const it = at % 2 ? { t: "t" + at } : { t: "t" + (at + 10) };
  try {
    it.t += "y";
    await null;
    refuse(at, 3);
    return "fine";
  } catch {
    return it.t;
  }
}

const seen: (number | string)[] = [];
for (let at = 0; at < 9; at++) {
  seen.push(objects(at), objectsRefusedFirst(at), pairs(at), instances(at), oneTryInAnother(at), ...steps(at), await later(at));
  try {
    leftByFinally(at, seen);
  } catch (error) {
    seen.push((error as Error).message);
  }
}
console.log(seen.join());

// The same in the loop itself, where nothing throws.
const quiet: (number | string)[] = [];
for (let at = 0; at < 9; at++) {
  let it: Row;
  if (at % 3) it = { n: at, t: "t" + at };
  else it = { n: at + 10, t: "t" + (at + 10) };
  try {
    it.t += "y";
    quiet.push(it.n);
  } catch {
    quiet.push(it.t);
  }
}
console.log(quiet.join());
