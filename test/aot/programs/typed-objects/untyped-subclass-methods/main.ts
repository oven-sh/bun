import * as core from "./core.ts";
import * as heirs from "./heirs.js";
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const attempt = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const classes: [string, new (given?: any) => core.Core][] = [
  ["Core", core.Core], ["Harmless", heirs.Harmless], ["Overrides", heirs.Overrides], ["NamedLikeFields", heirs.NamedLikeFields], ["Thenable", heirs.Thenable],
  ["Converts", heirs.Converts], ["BySymbols", heirs.BySymbols], ["NamedLikeAnotherType", heirs.NamedLikeAnotherType], ["BelowHarmless", heirs.BelowHarmless],
  ["BelowHarmlessNamedLikeFields", heirs.BelowHarmlessNamedLikeFields], ["WithFields", heirs.WithFields], ["Altered", heirs.Altered], ["Computed", heirs.Computed],
  ["Numbered", heirs.Numbered], ["Old", heirs.Old as any],
];
const look = (o: core.Core) => [
  core.readFirst(o) instanceof Function ? "a function" : core.readFirst(o), core.readSecond(o), core.readLate(o) instanceof Function ? "a function" : core.readLate(o), core.hasFirst(o), core.hasLate(o),
  core.readElsewhere(o), core.callArea(o), core.readSize(o), o.describe().replace(/first [\s\S]*? second/, "first .. second"), core.inText(o), core.asJSON(o), core.spread(o), core.keysOf(o),
];
async function all(round: number) {
  for (const [label, C] of classes) {
    const bare = new C();
    show(label + " bare " + round, look(bare));
    show(label + " stores " + round, [attempt(() => core.storeFirst(bare, "stored")), attempt(() => core.storeSecond(bare, "stored too")), attempt(() => bare.setLate("late"))]);
    show(label + " stored " + round, [look(bare), (bare as any).caught]);
    show(label + " given " + round, attempt(() => {
      const given = new C({ first: 1, second: 2 });
      return [look(given), (given as any).caught];
    }));
    show(label + " awaited " + round, [core.readFirst((await core.resolved(new C())) as core.Core), core.readFirst((await core.resolvedBy(new C())) as core.Core)].map(first => (first instanceof Function ? "a function" : first)));
    show(label + " is " + round, [bare instanceof C, bare instanceof core.Core, Object.getPrototypeOf(bare) === C.prototype, bare.constructor === C]);
  }
  show("Other " + round, [core.readElsewhere(core.makeOther()), core.readElsewhereOf(core.makeOther())]);
  const harmless: any = new heirs.Harmless();
  harmless.target = round;
  show("members " + round, [harmless.navigate("x"), harmless.isReady, harmless.kept, new heirs.BelowHarmless().more(), new heirs.WithFields().helper(), new (heirs.Old as any)().legacy(), heirs.Harmless.make() instanceof heirs.Harmless]);
}
for (let round = 0; round < 3; round++) await all(round);

const before = new heirs.Altered();
show("before it is altered", look(before));
Object.defineProperty(heirs.Altered.prototype, "first", { get() { return "added later"; }, configurable: true });
show("behind: made before", look(before));
show("behind: made now", look(new heirs.Altered()));
(heirs.Altered.prototype as any).helper = () => "replaced";
delete (heirs.Altered.prototype as any).first;
show("taken away again", [look(before), look(new heirs.Altered()), (before as any).helper()]);
(heirs.Harmless.prototype as any).late = "a value on the prototype";
show("Harmless gets a name of a field", [look(new heirs.Harmless()), look(new heirs.BelowHarmless())]);
Object.setPrototypeOf(heirs.Overrides.prototype, heirs.NamedLikeFields.prototype);
show("Overrides inherits from another", look(new heirs.Overrides()));
await all(3);
