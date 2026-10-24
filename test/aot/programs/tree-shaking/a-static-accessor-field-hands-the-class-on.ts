// `static accessor` has an initializer that runs when the class is defined, with `this` = the class. Nothing else names the class.
const registry: any[] = [];
function register(value: unknown) {
  registry.push(value);
  return registry.length;
}

class Unnamed {
  static accessor position = register(this);
  run() {
    return "ran, " + this.detail();
  }
  detail() {
    return "in detail";
  }
}

console.log(new registry[0]().run(), registry[0].position);
