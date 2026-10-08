function foo() {
  return a
    .b()
    .c()
    // Comment
    ?.d()
}

fooBar
  .doSomething("Hello World")
  .doAnotherThing("Foo", { foo: bar })

  // App configuration.
  .doOneMoreThing(config)

  ?.run(() => console.log("Bar"));

bigDeal

  .doSomething("Hello World")

  // Hello world
  ?.doAnotherThing("Foo", { foo: bar })

  // App configuration.
  .doOneMoreThing(config)

  ?.run(() => console.log("Bar"));

foo.bar.baz

  ?.doSomething("Hello World")

  // Hello world
  .foo.bar.doAnotherThing("Foo", { foo: bar })

  .doOneMoreThing(config)
  ?.bar.run(() => console.log("Bar"));

(somethingGood ? thisIsIt : maybeNot)

// Hello world
.doSomething("Hello World")

  ?.doAnotherThing("Foo", { foo: bar }) // Run this
  .run(() => console.log("Bar")); // Do this
