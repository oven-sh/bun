// Classes that are not declarations: a class expression in a const, a named one, one returned by a function (a mixin), one in an object, one that is constructed on the spot, and one as a default value.
function tell(text: string) { return "tells " + text; }
const InConst = class { run() { return tell("in a const"); } };
const Named = class Inner { run() { return tell(Inner.name); } };
function Mixin<T extends new (...args: any[]) => object>(Base: T) {
  return class extends Base { mixed() { return tell("mixed in"); } };
}
class Plain { plain() { return tell("plain"); } }
const Mixed = Mixin(Plain);
const table = { Entry: class { run() { return tell("in an object"); } } };
function withDefault(Klass = class { run() { return tell("a default value"); } }) { return new Klass().run(); }

console.log(new InConst().run(), new Named().run());
console.log(new Mixed().mixed(), new Mixed().plain());
console.log(new table.Entry().run());
console.log(new (class { run() { return tell("constructed on the spot"); } })().run());
console.log(withDefault());
