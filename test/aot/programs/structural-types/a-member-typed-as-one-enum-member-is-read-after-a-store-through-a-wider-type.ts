enum Color {
  Red,
  Green,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}

const holder: { color: Color.Red; way: Way.Up } = { color: Color.Red, way: Way.Up };
const wide: { color: Color; way: Way } = holder;
const wider: { color: number; way: string } = holder;

console.log(holder.color, holder.way);
wide.color = Color.Green;
wide.way = Way.Down;
console.log(holder.color);
console.log(holder.color === Color.Red);
console.log(Color[holder.color]);
console.log(holder.way);
console.log(holder.way === Way.Up);
wider.color = 2.5;
wider.way = "SIDE";
console.log(holder.color);
console.log(holder.color + 1);
console.log(holder.color === Color.Red);
console.log(holder.way);
console.log(holder.way.length);
