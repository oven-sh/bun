// Nothing names these classes. Defining a class evaluates its heritage, its computed keys, its static fields and blocks and its decorators, in the order written; fields of instances, methods and accessors wait for an instance. Beside each class that does something stands one that does not.
const log: string[] = [];
const effect = (name: string): any => { log.push(name); return name; };
const Base = class { static inherited = "inherited"; };

class Quiet1 { field = effect("never: a field"); method() { effect("never: a method"); } get value() { return effect("never: a getter"); } }
class Quiet2 extends Base { static plain = 1; static text = "x"; static list = [1, 2]; static fn = () => effect("never: a static arrow"); }
class Quiet3 { static #hidden = 1; #field = effect("never: a private field"); static { } }
class Quiet4 extends (null as any) {}
class Quiet5 { static self = this; static other = Quiet1; ["literal key"]() {} [1]() {} [Symbol.iterator]() {} }
class Loud1 { static field = effect("a static field"); }
class Loud2 { static { effect("a static block"); } }
class Loud3 { [effect("a computed key")]() {} }
// @ts-ignore
class Loud4 { static [effect("a static computed key")] = effect("and its value"); }
class Loud5 extends (effect("the heritage"), Base) {}
class Loud6 { static #hidden = effect("a private static field"); }
class Loud7 { static accessor auto = effect("a static accessor"); }
class Loud8 { static first = effect("first of two"); static second = effect("second of two"); }
class Loud9 { static made = new Loud1(); static read = Loud8.first.length; }
class Loud10 { static nested = class { static inner = effect("a class inside a static field"); }; }
class Loud11 { static fromBlock: string; static { this.fromBlock = effect("a store in a static block"); } }
const Loud12 = class { static field = effect("a class expression"); };
export class Loud13 { static field = effect("an exported class"); }
export default class { static field = effect("a default export without a name"); }

console.log(log.join("\n"));
