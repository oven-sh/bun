function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Texts {
  kept: number | string = 0;
  get value(): number | string {
    return this.kept;
  }
  set value(v: number | string) {
    this.kept = "<" + v + ">";
  }
}

class Drops {
  kept: Texts | null = null;
  get inner(): Texts | null {
    return this.kept;
  }
  set inner(v: Texts | null) {}
}

const t = new Texts();
t.value = 5;
say("typed number", t.value);
say("typed number plus one", t.value + 1);
say("typed number doubled", t.value * 2);
const n: number = t.value;
say("kept", n);

const d = new Drops();
d.inner = new Texts();
say("typed Texts", d.inner);
try {
  say("a member of it", d.inner.kept);
} catch (error) {
  say("a member of it threw a TypeError", error instanceof TypeError);
}
