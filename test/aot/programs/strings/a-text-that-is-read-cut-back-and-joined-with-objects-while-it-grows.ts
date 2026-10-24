// The text is read in the middle of its growth, cut back by a throw, and goes on growing.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const kept: string[] = [];
function readWhileGrowing(rounds: number, piece: string): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    out += piece;
    out += i;
    if (i % 7 === 3) kept.push(out);
    out += ",";
  }
  return out;
}

function failsAt(i: number, at: number): string {
  if (i === at) throw new RangeError("at " + i);
  return "<" + i + ">";
}

function cutBackByThrow(rounds: number, at: number): string {
  let out = "start";
  for (let i = 0; i < rounds; i++) {
    try {
      out += "a" + failsAt(i, at) + "b";
      out += i;
    } catch (error) {
      out += "!" + (error as Error).message;
    }
  }
  return out;
}

class Talker {
  said = 0;
  constructor(public name: string) {}
  toString(): string {
    this.said++;
    let out = "";
    for (let i = 0; i < this.said; i++) out += this.name + i;
    return out;
  }
  valueOf(): number {
    return this.said * 1000;
  }
}

function withObjects(rounds: number, talker: Talker, thrower: { toString(): string }): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    out += talker;
    out += `${talker}`;
    out += String(talker);
    out += "/";
    try {
      out += "before" + thrower;
    } catch {
      out += "caught";
    }
  }
  return out;
}

function withPrimitiveHook(rounds: number): string {
  let calls: string[] = [];
  const hooked = {
    [Symbol.toPrimitive](hint: string) {
      calls.push(hint);
      let inner = "";
      for (let i = 0; i < calls.length; i++) inner += hint + i;
      return inner;
    },
  };
  let out = "";
  for (let i = 0; i < rounds; i++) {
    out += hooked;
    out += `${hooked}`;
    out += ";";
  }
  return out + calls.join();
}

function withBigAndSymbol(): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += 12345678901234567890123456789012345678901234567890n * BigInt(i);
    out += String(Symbol("mark" + i));
    try {
      out += (Symbol("thrown") as unknown as string);
    } catch (error) {
      out += (error as Error).constructor.name;
    }
  }
  return out;
}

function grownByLongPieces(rounds: number): number {
  const long = "L".repeat(70000);
  const wide = "中".repeat(3);
  let out = "";
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    out += long;
    out += i;
    out += wide;
    out += "tail";
    if (i % 3 === 1) sum = (sum + hash(out)) >>> 0;
  }
  return (sum + hash(out)) >>> 0;
}

for (const rounds of [0, 1, 2, 5, 20, 100, 1000]) {
  for (const piece of ["", "p", "piece of sixteen", "a piece that is longer than sixteen characters", "\xe9", "中"]) {
    kept.length = 0;
    const text = readWhileGrowing(rounds, piece);
    let sum = hash(text);
    for (const earlier of kept) sum = (sum + hash(earlier)) >>> 0;
    console.log(rounds, piece.length, text.length, kept.length, sum);
  }
}
for (const at of [-1, 0, 1, 5, 19]) console.log(cutBackByThrow(20, at));
console.log(hash(withObjects(12, new Talker("t"), { toString() { throw new Error("no"); } })), withObjects(2, new Talker("u"), { toString() { throw new Error("no"); } }));
console.log(withPrimitiveHook(3), hash(withPrimitiveHook(40)));
console.log(withBigAndSymbol());
console.log(grownByLongPieces(1), grownByLongPieces(7), grownByLongPieces(40));
