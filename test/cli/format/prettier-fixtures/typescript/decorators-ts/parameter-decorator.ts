class Greeter {
  greeting: string;

  constructor(message: string) {
    this.greeting = message;
  }

  @validate
  greet(@required name: string) {
    return "Hello " + name + ", " + this.greeting;
  }

  @validate
  destructured(@required { toString }: Object) {
    return Function.prototype.toString.apply(toString);
  }
}
