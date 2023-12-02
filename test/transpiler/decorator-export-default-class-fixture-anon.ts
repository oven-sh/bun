function decorator(target: any, propertyKey: any) {
  target[propertyKey + "decorated"] = true;
}

export default class {
  @decorator
  method() {
    return 42;
  }
}
