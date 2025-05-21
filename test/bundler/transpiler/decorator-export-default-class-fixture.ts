function decorator(target: any, propertyKey: any) {
  target[propertyKey + "decorated"] = true;
}

export default class DecoratedClass {
  @decorator
  method() {
    return 42;
  }
}
