// Methods that no call names directly: through super.m(), through this[name](), through this.constructor, through a subclass in another file, through a variable typed as an interface, through the prototype and through a bound copy.
import { Base, type Speaker } from "./base";
import { Derived } from "./derived";

const derived = new Derived();
console.log(derived.viaSuper());
console.log(derived.dispatch("hid" + "den"));
console.log(derived.viaConstructor());
console.log(derived.inheritedOnly());
const speaker: Speaker = derived;
console.log(speaker.speak());
console.log(Base.prototype.speak.call({ name: "borrowed" }));
const { speak } = derived;
console.log(speak.bind({ name: "bound" })());
console.log(Object.getPrototypeOf(Derived).describeStatic());
