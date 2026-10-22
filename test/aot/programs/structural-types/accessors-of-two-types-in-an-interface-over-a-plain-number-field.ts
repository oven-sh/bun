function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

interface Sized {
  get size(): number;
  set size(value: number | string);
}

class Plain {
  size = 1;
  other = 2;
  twice(): number {
    return this.size * 2;
  }
}

const plain = new Plain();
const view: Sized = plain;
say("before", plain.size);
say("before, twice", plain.twice());
view.size = "text";
say("through the view", view.size);
say("through the view, plus one", view.size + 1);
say("through the class", plain.size);
say("through the class, plus one", plain.size + 1);
say("through the class, doubled", plain.size * 2);
say("a method of the class", plain.twice());
say("the other field", plain.other);
say("keys", Object.keys(plain).join());
view.size = 5;
say("a number again", plain.size + 1);
