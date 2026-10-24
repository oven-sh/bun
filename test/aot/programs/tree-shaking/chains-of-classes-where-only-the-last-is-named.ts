// Only the class at the end of each chain is named by code that runs. Above it: a class, a class expression in a constant, a mixin applied to a class, a class that is reached through a static field, one through a field's initializer, one through a method's body, one through a computed key.
class Root { root() { return "root"; } }
class Middle extends Root { middle() { return "middle, " + this.root(); } }
class Leaf extends Middle { leaf() { return "leaf, " + this.middle(); } }

const Expression = class { expression() { return "a class expression"; } };
class FromExpression extends Expression {}

const Mixin = (Base: typeof Root) => class extends Base { mixed() { return "mixed, " + this.root(); } };
class Plain extends Root {}
const Applied = Mixin(Plain);

class InStaticField { name() { return "in a static field"; } }
class HoldsStatic { static held = InStaticField; }
class InField { name() { return "in a field"; } }
class HoldsField { held = new InField(); }
class InMethod { name() { return "in a method"; } }
class HoldsMethod { make() { return new InMethod(); } }
const key = "computed";
class HoldsKey { [key]() { return "under a computed key"; } }

class UnusedRoot {}
class UnusedLeaf extends UnusedRoot {}
class SelfNaming { static self = SelfNaming; clone() { return new SelfNaming(); } }

console.log(new Leaf().leaf());
console.log(new FromExpression().expression(), new Applied().mixed());
console.log(new HoldsStatic.held().name(), new HoldsField().held.name(), new HoldsMethod().make().name(), new HoldsKey().computed());
