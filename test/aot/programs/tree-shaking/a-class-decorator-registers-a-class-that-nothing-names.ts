// No expression names Handler: the decorator gets the class and puts it into a list, and the program constructs what the list holds.
const registry: (new () => { run(): string })[] = [];

function register<T extends new () => { run(): string }>(value: T, context: ClassDecoratorContext): void {
  registry.push(value);
}

function suffix(): string {
  return "!";
}

@register
class Handler {
  name = "handler";
  run(): string {
    return this.describe() + suffix();
  }
  describe(): string {
    return "ran " + this.name;
  }
}

for (const entry of registry) console.log(new entry().run());
