import { Core, Valued } from "./core.ts";
export class Plain extends Core {
  constructor(options) {
    super(options);
  }
}
export class WithOwn extends Core {
  constructor(options) {
    super(options);
    this.own = "own " + options;
    this.fourth = "by the heir";
  }
}
export class WithSetter extends Core {
  constructor(options) {
    super(options);
  }
  set first(value) {
    this.caught = "caught " + value;
  }
  get first() {
    return "from the getter";
  }
}
export class WithSetterLater extends Core {}
export class WithReadOnly extends Core {}
Object.defineProperty(WithReadOnly.prototype, "third", { value: "read only", writable: false, configurable: true });
export class WithValue extends Core {}
WithValue.prototype.fourth = "a value above";
export class Deep extends Plain {}
export class OfValued extends Valued {
  constructor(options) {
    super(options);
  }
}
export function storeFourth(object, value) {
  object.fourth = value;
}
export function storeThird(object, value) {
  object.third = value;
}
