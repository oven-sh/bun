enum Op {
  A,
  B,
  C,
  D,
  E,
  F,
  G,
  H,
  I,
  J,
}
function nameOf(op: Op): string {
  switch (op) {
    case Op.A:
      return "a";
    case Op.B:
      return "b";
    case Op.C:
      return "c";
    case Op.D:
      return "d";
    case Op.E:
      return "e";
    case Op.F:
      return "f";
    case Op.G:
      return "g";
    case Op.H:
      return "h";
    case Op.I:
      return "i";
    case Op.J:
      return "j";
  }
}
const numbers: number[] = [0, 9, 10, -1, -0, 0.5, 8.999999999999998, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -(2 ** 32), 2 ** 32 + 9, 2 ** 53, 1e21, 5e-324, 4294967296.5];
for (const n of numbers) console.log(n, nameOf(n));
const wrapped: number = 2 ** 32 + 3;
console.log(nameOf(wrapped));
const tiny: number = 5e-324;
console.log(nameOf(tiny));
const minus: number = -0;
console.log(nameOf(minus));
