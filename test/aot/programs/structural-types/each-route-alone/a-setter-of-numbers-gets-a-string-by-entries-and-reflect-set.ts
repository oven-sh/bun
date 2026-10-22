function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Box {
  kept = 0;
  other = 5;
  get size(): number {
    return this.kept;
  }
  set size(value: number) {
    this.kept = value + 1;
  }
}

interface Wide {
  get size(): number;
  set size(value: number | string);
}

function change(b: Box): void {
  for (const [key, value] of Object.entries({ size: "text" })) Reflect.set(b, key, value);
}

let sum = 0;
const shared = new Box();
for (let i = 0; i < 2000; i++) {
  shared.size = i;
  sum += shared.size;
}
say("honest rounds", sum);
const box = new Box();
box.size = 1;
say("before", box.size);
change(box);
say("kept", box.kept);
say("kept plus one", box.kept + 1);
say("kept doubled", box.kept * 2);
say("size", box.size);
say("size plus one", box.size + 1);
say("other", box.other);
box.size = 1;
say("a number again", box.size);
