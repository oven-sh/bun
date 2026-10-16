// A key is made where a property is first stored. The definition of a field whose key is there already gives it a new value and leaves it where it is. So what the constructor of the class that is
// extended, or an initializer, stores under the name of a field that is yet to be defined comes first among the keys. Until then the object has no such property.
const keysOf = (object: object): string => Object.keys(object).join() + " " + JSON.stringify(object);
class StoresTwo { n = 0; constructor() { (this as any).more = 5; (this as any).x = 1; } }
class HeirOfStoresTwo extends StoresTwo { more = 2; }
class StoresOne { n = 0; constructor() { (this as any).more = 5; } }
class HeirOfStoresOne extends StoresOne { first = 0; more = 2; }
class CallsInit { n = 0; constructor() { this.init(); } init(): void {} }
class HeirOfCallsInit extends CallsInit { a = 1; b = 2; override init(): void { this.b = 9; } }
class BackToFront extends CallsInit { a = 1; b = 2; c = 3; override init(): void { this.c = 9; this.a = 8; } }
class Assigns { n = 0; constructor(given: object) { Object.assign(this, given); } }
class HeirOfAssigns extends Assigns { a = 1; b = 2; }
class Model { constructor(init?: object) { Object.assign(this, init); } }
class User extends Model { id = 0; name = ""; constructor(init?: Partial<User>) { super(init); Object.assign(this, init); } }
class Hooked { s = "s"; constructor() { console.log(Object.keys(this).join(), "x" in this, Object.hasOwn(this, "x"), Object.getOwnPropertyDescriptor(this, "x") === undefined, JSON.stringify(this)); this.hook(); } hook(): void {} }
class HeirOfHooked extends Hooked { x = 1; y?: number; z: string | undefined; override hook(): void { this.y = 5; this.z = "hook"; console.log(Object.keys(this).join(), "y" in this, "x" in this); } }
class ByItsOwnInitializer { a = this.init(); b?: number; c = 2; init(): number { this.b = 7; this.c = 9; return 1; } }
class RunsCode extends CallsInit { p = keysOf(this).length; q = 1; override init(): void { this.q = 4; } }
class StoresUndefined extends CallsInit { a = 1; b: number | undefined = 2; override init(): void { (this as any).b = undefined; } }
for (let round = 0; round < 3; round++) {
  const made = [new HeirOfStoresTwo(), new HeirOfStoresOne(), new HeirOfCallsInit(), new BackToFront(), new HeirOfAssigns({ b: 7, z: 1 }), new User({ name: "n", id: 5 }), new User({ id: 5, name: "n" }), new User(), new HeirOfHooked(), new ByItsOwnInitializer(), new RunsCode(), new StoresUndefined()];
  for (const object of made) console.log(round, object.constructor.name, keysOf(object));
}
let last = "";
for (let i = 0; i < 300; i++) last = keysOf(new User({ name: "n", id: i })) + keysOf(new HeirOfCallsInit()) + keysOf(new BackToFront());
console.log(last);
