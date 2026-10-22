class Timer {
  ticks = 0;
  tick(): number {
    return ++this.ticks;
  }
}

function tickOf(t: Timer): number {
  return t.tick();
}

function counting(step: number): (() => number) & { calls: number; step: number } {
  const f = Object.assign(
    function (this: Timer): number {
      f.calls++;
      this.ticks += step;
      return this.ticks;
    },
    { calls: 0, step },
  );
  return f;
}

const t = new Timer();
const other = new Timer();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += tickOf(t) + t.tick() + tickOf(other);
console.log("2000 honest: " + warm + " " + t.ticks + " " + other.ticks);

const byTen = counting(10);
t.tick = byTen;
console.log("own, with members: " + t.tick() + " " + tickOf(t) + " " + tickOf(t) + ", calls " + byTen.calls + ", keys of the function " + Object.keys(t.tick).join());
console.log("the other: " + tickOf(other));
console.log("the same function: " + (t.tick === byTen) + ", own " + Object.hasOwn(t, "tick") + ", keys " + Object.keys(t).join());

byTen.step = 1;
console.log("a member of the function is stored to: " + tickOf(t) + ", calls " + byTen.calls);

Reflect.deleteProperty(t, "tick");
console.log("uncovered: " + tickOf(t) + ", calls " + byTen.calls);

const original = Timer.prototype.tick;
const byHundred = counting(100);
Timer.prototype.tick = byHundred;
console.log("on the prototype: " + t.tick() + " " + tickOf(other) + " " + new Timer().tick() + ", calls " + byHundred.calls);
Timer.prototype.tick = original;
console.log("put back: " + tickOf(t) + " " + tickOf(other) + ", calls " + byHundred.calls);

interface Described {
  (): number;
  note: string;
}

class Panel {
  measure: Described = Object.assign(() => 1, { note: "first" });
}

function measureOf(p: Panel): string {
  return p.measure() + " " + p.measure.note;
}

const panel = new Panel();
let letters = 0;
for (let i = 0; i < 2000; i++) letters += measureOf(panel).length;
console.log("2000 honest: " + letters + ", " + measureOf(panel));
panel.measure = Object.assign(() => 2, { note: "second", extra: true });
console.log("another one: " + measureOf(panel) + ", keys " + Object.keys(panel.measure).join());
panel.measure.note = "changed";
console.log("its member is stored to: " + measureOf(panel));
console.log("a new panel: " + measureOf(new Panel()));

export {};
