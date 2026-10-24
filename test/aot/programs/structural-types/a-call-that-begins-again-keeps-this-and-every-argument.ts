// A method with a typed `this`, defaults and more arguments than parameters begins again in its generic version: it sees the same `this` and the same arguments.
// STATISTIC: RestartsInGenericVersion >= 1
type Size = { w: number; h: number };

class Frame {
  name: string;
  size: Size;
  constructor(name: string, size: Size) {
    this.name = name;
    this.size = size;
  }
  area(scale: Size, extra: number = 2): string {
    return this.name + " " + (this.size.w * scale.w + this.size.h * scale.h + extra);
  }
}

function grow(size: Size, by: Size, times: number): string {
  const w = size.w + by.w * times;
  const h = size.h + by.h * times;
  return w + "x" + h;
}

const methods: Record<string, Function> = { area: Frame.prototype.area, grow };
const which = process.argv[2] ?? "area";

const sizes: any[] = [{ w: 1, h: 2 }, { w: 3, h: 4 }, { w: "5", h: 6 }, { h: 7, w: 8 }, { w: 9 }, Object.defineProperty({ w: 1, h: 1 }, "h", { get: () => 11 }), null, 12];
const frames: any[] = [new Frame("a", { w: 1, h: 1 }), new Frame("b", sizes[2]), { name: "no frame", size: sizes[0] }, Object.assign(new Frame("c", sizes[1]), { name: 5 })];

for (let round = 0; round < 3; round++) {
  for (const frame of frames) {
    for (const size of sizes) {
      for (const rest of [[], [3], [undefined, "ignored"], ["4"]]) {
        let answer: string;
        try {
          answer = methods[which].call(frame, size, ...rest);
        } catch (error) {
          answer = "threw " + (error as Error).constructor.name;
        }
        console.log(round, answer);
      }
    }
  }
  for (const a of sizes) {
    for (const b of sizes) {
      let answer: string;
      try {
        answer = methods.grow(a, b, round);
      } catch (error) {
        answer = "threw " + (error as Error).constructor.name;
      }
      console.log(round, answer);
    }
  }
}
