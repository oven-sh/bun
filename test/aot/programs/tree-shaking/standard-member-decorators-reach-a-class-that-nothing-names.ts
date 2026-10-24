// A standard decorator of a static method adds an initializer, which runs with `this` = the class. The class is named nowhere. The decorators themselves are named only after an @.
const kept: any[] = [];

function keepClass(value: Function, context: ClassMethodDecoratorContext): void {
  context.addInitializer(function (this: any) {
    kept.push(this);
  });
}

function twice(value: (this: any) => string, context: ClassMethodDecoratorContext) {
  return function (this: any): string {
    return value.call(this) + " " + value.call(this);
  };
}

class Unnamed {
  @keepClass static marked(): void {}
  @twice run(): string {
    return this.word();
  }
  word(): string {
    return "ran";
  }
}

console.log(new kept[0]().run());
