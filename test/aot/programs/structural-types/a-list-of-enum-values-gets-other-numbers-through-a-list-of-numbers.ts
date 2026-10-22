enum Color {
  Red,
  Green,
  Blue,
}

const colors: Color[] = [Color.Red, Color.Green, Color.Blue];
const wide: number[] = colors;

function sum(list: Color[]): number {
  let total = 0;
  for (const color of list) total += color;
  return total;
}
function whole(list: Color[]): string {
  return list.map(color => color | 0).join();
}
function names(list: Color[]): string {
  return list.map(color => Color[color]).join();
}

const half: number = 1.5;
const odd: Color = half;
console.log(sum(colors), whole(colors), names(colors), colors.indexOf(odd), colors.includes(odd));
wide.push(1.5);
console.log(sum(colors));
console.log(whole(colors));
console.log(names(colors));
console.log(colors[3], colors[3] === odd, colors[3] + 1);
console.log(colors.indexOf(odd), colors.includes(odd), colors.lastIndexOf(odd));
wide.push(NaN, -0, 2 ** 31);
console.log(sum(colors));
console.log(whole(colors));
console.log(colors.join());
console.log(Object.is(colors[5], -0), 1 / colors[5]);
console.log(colors.indexOf(Color.Red), colors.lastIndexOf(Color.Red), colors.includes(colors[4]), colors.indexOf(colors[4]));
console.log(colors.slice().sort((a, b) => a - b).join());
