enum Color {
  Red,
  Green,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}
type ColorKey = `color-${Color}`;
type WayKey = `${Way}-${Color}`;

const byColor: Record<ColorKey, number> = { "color-0": 1, "color-1": 2 };
const byWay: Partial<Record<WayKey, string>> = { "UP-0": "up red" };

function keyOf(color: Color): ColorKey {
  return `color-${color}`;
}
function read(color: Color): number {
  return byColor[keyOf(color)];
}
function wayKey(way: Way, color: Color): WayKey {
  return `${way}-${color}`;
}

console.log(keyOf(Color.Green), read(Color.Green), wayKey(Way.Up, Color.Red), byWay[wayKey(Way.Up, Color.Red)], byWay[wayKey(Way.Down, Color.Red)]);
const numbers: number[] = [2, 0.5, -0, NaN, 1e21];
for (const n of numbers) {
  const color: Color = n;
  console.log(keyOf(color), read(color), read(color) === undefined, typeof read(color), read(color) + 1, wayKey(Way.Down, color));
}
