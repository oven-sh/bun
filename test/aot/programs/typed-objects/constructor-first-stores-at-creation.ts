// A field that is only declared is absent until it is stored to. Where the constructor stores to it before anybody can look at the object, nobody can tell whether it was there from the start.
// IR+ ^layout L\d+ .*name="Core" .*\{name="options" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
// IR- ^layout L\d+ .*name="Core" .*\{name="later" declared=[^{}]* initialization=(SetAtCreation|StoredBeforeEveryRead)
class Core {
  declare name: string; declare size: number; declare run: (x: number) => number; declare options: unknown; declare later?: string;
  constructor(name: string, options: any) { this.name = name; this.size = options.size; this.run = x => x + this.size; this.options = options; }
}
class OutOfOrder { declare a: number; declare b: number; declare c: number; constructor() { this.b = 2; this.a = 1; this.c = 3; } }
class Mixed { first = 1; declare second: number; third = 3; declare fourth: number; constructor() { this.second = 2; this.fourth = 4; } }
class Looks { declare a: number; declare b: number; seen: string; constructor() { this.a = 1; this.seen = Object.keys(this).join() + ("b" in this); this.b = 2; } }
class Sometimes { declare a: number; declare b?: number; declare c: number; constructor(withB: boolean) { this.a = 1; if (withB) this.b = 2; this.c = 3; } }
class Fails { declare a: number; declare b: number; constructor(source: any) { this.a = 1; this.b = source.b; } }
class Base { declare a: number; constructor() { this.a = 1; } }
class Heir extends Base { declare b: number; own = 5; constructor() { super(); this.b = 2; } }
class Undefined { declare a: number | undefined; declare b: number; constructor() { this.a = undefined; this.b = 2; } }
class Twice { declare a: number; declare b: number; constructor() { this.a = 1; this.b = 2; this.a = 3; } }
class LetsOut { declare a: number; declare b: number; constructor(sink: (made: LetsOut) => void) { this.a = 1; sink(this); this.b = 2; } }
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
const tell = (made: object) => Object.keys(made).join() + " " + JSON.stringify(made);
show("stored first", () => { const core = new Core("n", { size: 2 }); return [tell(core), core.run(1), "later" in core, Object.hasOwn(core, "run"), core.later].join(" "); });
show("a getter runs in between", () => { let seen = 0; const core = new Core("n", { get size() { seen++; return 7; } }); return [seen, core.size, Object.keys(core).join()].join(" "); });
show("out of order", () => tell(new OutOfOrder));
show("between fields that are defined", () => tell(new Mixed));
show("it looks at itself", () => { const made = new Looks; return [made.seen, tell(made)].join(" "); });
show("sometimes", () => [tell(new Sometimes(true)), tell(new Sometimes(false)), "b" in new Sometimes(false)].join(" "));
show("it fails on the way", () => new Fails(null));
show("it fails in a getter", () => new Fails({ get b(): number { throw new RangeError("no b"); } }));
show("extended", () => [tell(new Heir), tell(new Base)].join(" "));
show("undefined is stored", () => { const made = new Undefined; return [tell(made), "a" in made, Object.keys(made).length].join(" "); });
show("stored twice", () => tell(new Twice));
show("let out on the way", () => { let seen = ""; const made = new LetsOut(half => { seen = tell(half) + ("b" in half); }); return [seen, tell(made)].join(" "); });
show("deleted and stored again", () => { const core = new Core("n", { size: 1 }); delete (core as any).size; core.size = 9; return tell(core); });
show("created later", () => { const core = new Core("n", { size: 1 }); core.later = "l"; return tell(core); });
show("descriptor", () => { const d = Object.getOwnPropertyDescriptor(new Core("n", { size: 1 }), "size")!; return [d.value, d.writable, d.enumerable, d.configurable].join(); });
let total = 0;
const kept: Core[] = [];
for (let i = 0; i < 3000; i++) { const core = new Core("c" + (i & 7), { size: i & 3 }); kept[i & 7] = core; total += core.run(1) + core.name.length; }
console.log(total, kept.map(core => core.name + core.size).join());
