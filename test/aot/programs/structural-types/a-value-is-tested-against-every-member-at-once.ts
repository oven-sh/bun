enum Color {
  Red,
  Green,
}
function known(color: Color): boolean {
  return color === Color.Red || color === Color.Green;
}
function unknown(color: Color): boolean {
  return color !== Color.Red && color !== Color.Green;
}
function pick(color: Color): number {
  return color === Color.Red ? 10 : color === Color.Green ? 20 : color;
}
const two: number = 2;
console.log(known(two), unknown(two), known(two) ? "known" : "unknown");
console.log(pick(two), pick(two) === undefined, pick(two) + 1);
const flags: boolean[] = [true];
const odd = flags[1];
console.log(odd === true || odd === false, odd !== true && odd !== false);
