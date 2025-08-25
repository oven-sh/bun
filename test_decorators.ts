function wrap<This, T>(value: T, ctx: ClassFieldDecoratorContext<This, T>) {
  console.log('Wrapping', value, ctx);
  ctx.addInitializer(function W() {
    console.log('Initialized', this, value);
  });
}

class A {
  @wrap
  public a: number = 1;
}

const a = new A();
console.log('a.a =', a.a);