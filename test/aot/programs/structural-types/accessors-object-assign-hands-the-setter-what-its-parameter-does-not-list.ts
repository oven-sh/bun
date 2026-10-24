function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

const seen: string[] = [];

class Box {
  kept = 0;
  get size(): number {
    return this.kept;
  }
  set size(value: number | string) {
    seen.push(typeof value);
    this.kept = typeof value === "string" ? value.length : value + 1;
  }
}

const box = new Box();
Object.assign(box, { size: 4 });
say("a number", box.size);
Object.assign(box, { size: "four" });
say("a string", box.size);
Object.assign(box, { size: true });
say("a boolean", box.size);
Object.assign(box, { size: null });
say("null", box.size);
Object.assign(box, { size: undefined });
say("undefined", box.size);
try {
  Object.assign(box, { size: 5n });
  say("a bigint", box.size);
} catch (error) {
  say("a bigint threw a TypeError", error instanceof TypeError);
}
Object.assign(box, { size: { valueOf: () => 41 } });
say("an object with valueOf", box.size);
Object.assign(box, { size: [7] });
say("an array", box.size);
say("what the setter saw", seen.join());
