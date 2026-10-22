function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

abstract class Promised {
  abstract get size(): number;
  abstract set size(value: number | string);
  fill(): void {
    this.size = "text";
  }
}

class AField extends Promised {
  size = 5;
  other = 6;
  twice(): number {
    return this.size * 2;
  }
}

const o = new AField();
say("before", o.size);
say("before, twice", o.twice());
o.fill();
say("after", o.size);
say("after, plus one", o.size + 1);
say("after, doubled", o.size * 2);
say("after, twice", o.twice());
say("the other field", o.other);
