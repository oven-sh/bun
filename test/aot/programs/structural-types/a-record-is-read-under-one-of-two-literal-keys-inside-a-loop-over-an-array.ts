type ColorKey = "color-0" | "color-1";
const byColor: Record<ColorKey, number> = { "color-0": 1, "color-1": 2 };
function keyOf(color: number): ColorKey {
  return `color-${color}` as ColorKey;
}
function read(color: number): number {
  return byColor[keyOf(color)];
}

const whole: number[] = [2, 1, 0];
for (const n of whole) console.log("whole", n, read(n));

const mixed: number[] = [2, 0.5, -0, NaN, 1e21, 1];
for (const n of mixed) console.log("mixed", n, read(n), read(n) + 1);

const pushed: number[] = [];
pushed.push(1, 0.5, 0);
for (const n of pushed) console.log("pushed", n, read(n), typeof read(n));

const counted: number[] = [0, 3, 1];
for (let i = 0; i < counted.length; i++) console.log("counted", counted[i], read(counted[i]), read(counted[i]) === undefined);
