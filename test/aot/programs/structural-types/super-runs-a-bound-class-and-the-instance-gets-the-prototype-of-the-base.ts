class Base {
  x = 1;
  sum(): number {
    return this.x + 1;
  }
}
const Bound = Base.bind(null);
Object.defineProperty(Bound, "prototype", { value: Base.prototype });
class Derived extends Bound {
  twice(): number {
    return this.sum() * 2;
  }
}
const made = new Derived();
console.log("zq prototype is the subclass's: " + (Object.getPrototypeOf(made) === Derived.prototype) + " the base's: " + (Object.getPrototypeOf(made) === Base.prototype));
console.log("zq typeof twice " + typeof made.twice + " typeof sum " + typeof made.sum);
