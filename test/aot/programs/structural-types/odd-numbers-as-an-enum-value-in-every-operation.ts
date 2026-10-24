enum Color {
  Red,
  Green,
  Blue,
}
const names: Record<Color, string> = { [Color.Red]: "red", [Color.Green]: "green", [Color.Blue]: "blue" };
const half: number = 0.5;
const c: Color = half;
console.log(c, c === Color.Red, c === Color.Green, c < Color.Green, c > Color.Red, c | 0, c + 1, c * 2, -c, ~c, c >> 0, c >>> 0);
console.log(names[c], Color[c], ["r", "g", "b"][c], names[c] === undefined, typeof Color[c]);
console.log(Number.isInteger(c), Math.floor(c), Math.round(c), c % 1, c === (c | 0), String(c), JSON.stringify(c));
switch (c) {
  case Color.Red:
    console.log("red");
    break;
  case Color.Green:
    console.log("green");
    break;
  case Color.Blue:
    console.log("blue");
    break;
  default:
    console.log("default", c);
}
const nan: number = NaN;
const n: Color = nan;
console.log(n, n === n, n !== n, n === Color.Red, n | 0, n < 1, n >= 0, Color[n], names[n], Number.isNaN(n), n ? 1 : 0);
const minus: number = -0;
const z: Color = minus;
console.log(Object.is(z, -0), z === Color.Red, 1 / z, names[z], Color[z], z | 0, Object.is(z | 0, -0), Object.is(-z, 0), String(z), Object.is(z + 0, -0), Object.is(z * 1, -0));
const big: number = 2 ** 31;
const b: Color = big;
console.log(b, b | 0, b + 1, b === Color.Red, b > Color.Blue, b >>> 0, b * 2, names[b], ~b);
