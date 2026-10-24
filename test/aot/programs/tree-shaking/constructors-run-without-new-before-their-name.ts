// Classes that are constructed by Reflect.construct, by `new (pick())()`, by new on a member of an array, through new.target, through a bound copy, by a subclass that has no constructor of its own and by Object.create plus call of a function.
function note(text: string) { return "constructed " + text; }
class ByReflect { value = note("by Reflect.construct"); }
class ByPick { value = note("by new (pick())()"); }
class InArray { value = note("from an array"); }
class ByNewTarget {
  value = note("through new.target");
  static again(this: unknown, first: ByNewTarget) { return first.copy; }
  copy: ByNewTarget | undefined;
  constructor(nested = false) { if (!nested) this.copy = new new.target(true); }
}
class Bound { constructor(public value: string) {} }
class Parent { value = note("by a subclass without a constructor"); }
class Child extends Parent {}
function Old(this: { value: string }) { this.value = note("by call on Object.create"); }
class AsNewTarget { describe() { return "prototype of the new.target argument"; } }

function pick() { return ByPick; }
console.log(Reflect.construct(ByReflect, []).value);
console.log(new (pick())().value);
console.log(new [InArray][0]().value);
console.log(new ByNewTarget().copy!.value);
console.log(new (Bound.bind(null, note("through bind")))().value);
console.log(new Child().value);
const old = Object.create(Old.prototype);
Old.call(old);
console.log(old.value, old instanceof Old);
console.log((Reflect.construct(Object, [], AsNewTarget) as AsNewTarget).describe());
