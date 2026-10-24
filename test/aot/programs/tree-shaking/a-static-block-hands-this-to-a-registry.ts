// No expression names Plugin: its static block passes `this` on, and the methods run through that.
const registry: { create(): { run(): string } }[] = [];

function helper(): string {
  return "helped";
}

class Plugin {
  static {
    registry.push(this);
  }
  static create(): Plugin {
    return new this();
  }
  run(): string {
    return "plugin " + helper();
  }
}

console.log(registry[0].create().run());
