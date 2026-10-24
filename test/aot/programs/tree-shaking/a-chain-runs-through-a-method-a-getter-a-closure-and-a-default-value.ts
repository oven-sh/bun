// The program names only Start. From its method the chain goes on through a function, a getter of another class, a closure in a field, a default value of a parameter, a default in a pattern, and a static method.
class Start {
  go(): string {
    return afterMethod();
  }
}
function afterMethod(): string {
  return new WithGetter().value;
}
class WithGetter {
  get value(): string {
    return afterGetter();
  }
}
function afterGetter(): string {
  return new WithField().closure();
}
class WithField {
  closure = () => afterField();
}
function afterField(value = afterDefault()): string {
  return value;
}
function afterDefault({ value = afterPatternDefault() }: { value?: string } = {}): string {
  return value;
}
function afterPatternDefault(): string {
  return WithStatic.last();
}
class WithStatic {
  static last(): string {
    return "the end of the chain";
  }
}

console.log(new Start().go());
