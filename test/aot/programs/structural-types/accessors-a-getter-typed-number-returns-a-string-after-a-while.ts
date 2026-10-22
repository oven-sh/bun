function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Gauge {
  raw: number | string = 1;
  ticks = 0;
  tick(): void {
    this.ticks++;
    if (this.ticks > 2) this.raw = "text";
  }
  get level(): number {
    if (typeof this.raw === "number") {
      this.tick();
      return this.raw;
    }
    return -1;
  }
}

const gauge = new Gauge();
for (let i = 0; i < 5; i++) {
  const level = gauge.level;
  say("read " + i, level);
  say("read " + i + " plus one", level + 1);
  say("read " + i + " doubled", level * 2);
}

function half(n: number): number {
  return n / 2;
}

const second = new Gauge();
say("first", half(second.level));
say("second", half(second.level));
say("third", half(second.level));
say("fourth", half(second.level));
