// Symbol.for answers the same symbol for the same text wherever it is called, so a field under it is found through every call.
export {};

const kShared = Symbol.for("shared.mass");
const kLocal = Symbol("shared.mass");
class Body {
  [kShared]: number;
  [kLocal]: number;
  constructor(mass: number) {
    this[kShared] = mass;
    this[kLocal] = -mass;
  }
}
function again(): symbol {
  return Symbol.for("shared" + "." + ["mass"][0]);
}
const bodies = [new Body(1), new Body(2)];
let total = 0;
for (let round = 0; round < 300; round++)
  for (const body of bodies)
    total += body[kShared] * 10 + (body as any)[Symbol.for("shared.mass")] + (body as any)[again()];
console.log(
  total,
  kShared === again(),
  (kShared as symbol) === kLocal,
  Symbol.keyFor(kShared),
  Symbol.keyFor(kLocal),
  bodies[0][kLocal],
);
(bodies[0] as any)[again()] = 50;
console.log(bodies[0][kShared], Object.getOwnPropertySymbols(bodies[0]).length);
