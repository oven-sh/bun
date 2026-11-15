import { check } from "../src/show";
import { Base, callWho, callHello, readProp, loopWho } from "fake-shapes/more";
import { Middle, Quiet } from "../src/middle";
const F = "29";
class Leaf extends Middle {}
class QuietLeaf extends Quiet {}
const all = (o: any) => [o.who(), callWho(o), o.hello(), callHello(o), o.prop, readProp(o), loopWho(o, 12)];
check(F, "as written", () => [new Base(), new Middle(), new Quiet(), new Leaf(), new QuietLeaf()].map(all));
check(F, "a method appears in the middle", () => { const o = new QuietLeaf(); const before = all(o); (Quiet.prototype as any).who = function () { return "quiet now"; }; const during = all(o); delete (Quiet.prototype as any).who; return [before, during, all(o)]; });
check(F, "a method appears at the bottom and on the object", () => { const o: any = new Leaf(); const a = all(o); (Leaf.prototype as any).who = () => "leaf"; const b = all(o); o.who = () => "own"; const c = all(o); delete o.who; delete (Leaf.prototype as any).who; return [a, b, c, all(o)]; });
check(F, "the top changes", () => { const o = new QuietLeaf(), old = Base.prototype.who; const a = all(o); Base.prototype.who = function () { return "new base"; }; const b = all(o); Base.prototype.who = old; return [a, b, all(o)]; });
check(F, "an accessor replaces an accessor, a value replaces an accessor", () => { const o = new Leaf(); const a = all(o); Object.defineProperty(Middle.prototype, "prop", { get() { return "middle prop"; }, configurable: true }); const b = all(o); Object.defineProperty(Middle.prototype, "prop", { value: "a value", configurable: true, writable: true }); const c = all(o); delete (Middle.prototype as any).prop; return [a, b, c, all(o)]; });
check(F, "the chain is cut and joined", () => { const o = new QuietLeaf(); const a = all(o); Object.setPrototypeOf(QuietLeaf.prototype, Middle.prototype); const b = all(o); Object.setPrototypeOf(QuietLeaf.prototype, Quiet.prototype); return [a, b, all(o), o instanceof Quiet]; });
check(F, "Object.prototype gets the name", () => { const o: any = new QuietLeaf(); const a = [o.fromTop, readProp({})]; (Object.prototype as any).fromTop = "top"; (Object.prototype as any).prop = "top prop"; const b = [o.fromTop, readProp({}), readProp(o), readProp([])]; delete (Object.prototype as any).fromTop; delete (Object.prototype as any).prop; return [a, b, o.fromTop, readProp({})]; });
check(F, "static make through the chain", () => [Leaf.make().who(), QuietLeaf.make().hello(), Leaf.make() instanceof Leaf, (Base.make as any).call(Middle).extra]);
