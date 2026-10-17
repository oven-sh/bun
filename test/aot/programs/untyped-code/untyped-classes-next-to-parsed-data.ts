// Constructor functions, replaced prototypes and names stored on prototypes in code that says nothing of its types, beside data that is parsed and cast: the tables of the whole program and the search for what is given are made of the same files.
interface Settings { name: string; limits: { low: number; high: number }; tags: string[] }
function Counter(this: any, start: number) { this.value = start; this.steps = 0; }
Counter.prototype.step = function (by: number) { this.value += by; this.steps++; return this; };
Counter.prototype.kind = "counter";
function Timer(this: any, name: string) { this.name = name; }
Timer.prototype = { constructor: Timer, describe() { return "timer " + (this as any).name; } };
Object.defineProperty(Counter.prototype, "doubled", { get() { return this.value * 2; } });
class Base { label = "base"; describe() { return this.label; } }
class Derived extends Base { label = "derived"; extra = 1; }
Counter.prototype.late = function () { return this.steps + 1; };
const settings = JSON.parse('{"name":"s","limits":{"low":1,"high":9},"tags":["a","b"]}') as Settings;
const counter = new (Counter as any)(settings.limits.low);
counter.step(settings.limits.high).step(2);
const timer = new (Timer as any)(settings.name);
const derived: any = new Derived();
console.log(counter.value, counter.steps, counter.kind, counter.doubled, timer.describe(), derived.describe(), counter.late(), derived.extra, settings.tags.join("+"));
console.log(Object.keys(counter).join(), Object.getPrototypeOf(timer) === Timer.prototype, timer instanceof (Timer as any), "late" in counter, JSON.stringify(settings));
