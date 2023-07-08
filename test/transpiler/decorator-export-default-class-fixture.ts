function decorator(target: any, propertyKey: any) {
  target[propertyKey + "decorated"] = 42;
}

export default class DecoratedClass {
  @decorator
  method() {
    return 42;
  }
}
