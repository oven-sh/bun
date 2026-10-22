function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class TakesText {
  kept = "start";
  get v(): number {
    return this.kept.length;
  }
  set v(value: string) {
    this.kept = value;
  }
}

function store(o: { v: number }): void {
  o.v = 12;
}

const t = new TakesText();
say("before", t.v);
store(t);
say("the field typed string", t.kept);
say("the field typed string, joined", t.kept + "!");
say("the getter typed number", t.v);
say("the getter typed number, plus one", t.v + 1);
t.v = "again";
say("a string again", t.v);
