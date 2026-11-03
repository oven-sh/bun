// The drivers of v8::Object::Clone(), apart from the others: `bun build --compile --aot` builds them without any
// built-in module, so that v8.test.ts can run them as compiled code too.
module.exports = nativeModule => ({
  test_v8_object_clone() {
    let getterCalls = 0;
    const getter = () => {
      getterCalls++;
      return "value from the getter";
    };
    const setter = value => {};
    const symbol = Symbol("symbol key");
    const nested = { shared: true };
    class Base {
      method() {
        return "method on the prototype";
      }
    }
    // One entry per own property: key, what it holds, and a letter for each of writable, enumerable and configurable.
    const describe = object =>
      Reflect.ownKeys(object)
        .map(key => {
          const d = Object.getOwnPropertyDescriptor(object, key);
          const holds =
            "value" in d
              ? JSON.stringify(d.value)
              : `accessor (same getter: ${d.get === getter}, same setter: ${d.set === setter})`;
          const attributes = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
          return `${key === symbol ? "[symbol]" : String(key)} = ${holds} ${attributes}`;
        })
        .join(", ");

    // The properties added after the literal do not all fit in the object itself.
    const withData = { number: 1, string: "two", nested };
    for (const name of ["third", "fourth", "fifth", "sixth"]) withData[name] = name;

    const instance = new Base();
    instance.data = "data value";
    instance.nested = nested;
    instance[symbol] = "symbol value";
    Object.defineProperty(instance, "hidden", { value: "non-enumerable", writable: true, configurable: true });
    Object.defineProperty(instance, "accessor", { get: getter, set: setter, enumerable: true, configurable: true });

    const someDeleted = { nested };
    for (let i = 0; i < 60; i++) someDeleted["p" + i] = i;
    for (let i = 0; i < 60; i += 3) delete someDeleted["p" + i];

    const frozen = Object.freeze({ data: "data value", nested });
    const withoutPrototype = Object.assign(Object.create(null), { data: "data value", nested });

    // Bun copies the words of each object above with its Structure. It cannot share the Structure of the objects
    // below, and gives their copy each property by definition.
    const withIndexKey = { 0: "index key", data: "data value", nested };
    const usedAsPrototype = { data: "data value", nested };
    Object.create(usedAsPrototype);
    const with200Properties = { nested };
    for (let i = 0; i < 200; i++) with200Properties["p" + i] = i;
    const fromJSON = JSON.parse('{ "__proto__": "own property", "7": "index key", "data": "data value" }');
    const frozenWithIndexKey = Object.freeze({ 0: "index key", data: "data value", nested });
    const withAccessorAndIndexKey = { 0: "index key", nested };
    Object.defineProperty(withAccessorAndIndexKey, "accessor", {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
    // In a `bun build --compile --aot` executable, an object that native code fills is one of these until the turn ends.
    const [madeByAddon, copyMadeByAddon] = nativeModule.clone_object_made_by_addon();

    for (const [description, original, copyByAddon] of [
      ["object with data properties", withData],
      ["class instance with data, non-enumerable, accessor and symbol properties", instance],
      ["object with 60 properties, some deleted", someDeleted],
      ["frozen object", frozen],
      ["object without a prototype", withoutPrototype],
      ["object with an index key", withIndexKey],
      ["object that was used as a prototype", usedAsPrototype],
      ["object with 200 properties added in a loop", with200Properties],
      ["object from JSON.parse() with an own __proto__ key and an index key", fromJSON],
      ["frozen object with an index key", frozenWithIndexKey],
      ["object with an accessor property and an index key", withAccessorAndIndexKey],
      [
        "object that the addon made with Object::New() and Set(), and cloned in the same call",
        madeByAddon,
        copyMadeByAddon,
      ],
    ]) {
      console.log(`====== ${description}`);
      const before = describe(original);
      const getterCallsBefore = getterCalls;
      const copy = copyByAddon ?? nativeModule.perform_object_clone(original);
      const secondCopy = nativeModule.perform_object_clone(original);
      console.log("copy is another object:", copy !== original);
      console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
      console.log("own properties of the copy:", describe(copy));
      console.log("same as the original's:", describe(copy) === before);
      console.log(
        "extensible, sealed, frozen:",
        Object.isExtensible(copy),
        Object.isSealed(copy),
        Object.isFrozen(copy),
      );
      console.log("nested object is shared:", copy.nested === nested);
      if (Object.hasOwn(original, "accessor")) {
        console.log("getter calls during Clone():", getterCalls - getterCallsBefore);
        console.log("accessor read on the copy:", copy.accessor);
      }
      if (original === instance) console.log("method called on the copy:", copy.method());

      // Writes to one of the three objects must not show up in the other two.
      const keys = Reflect.ownKeys(original);
      const [first, last] = [keys[0], keys[keys.length - 1]];
      copy[first] = copy[last] = "changed on the copy";
      copy.addedToCopy = true;
      delete copy.nested;
      const copyAfter = describe(copy);
      console.log("copy after writing to it:", copyAfter);
      console.log("original is unchanged:", describe(original) === before);
      console.log("second copy is unchanged:", describe(secondCopy) === before);
      original[first] = original[last] = "changed on the original";
      original.addedToOriginal = true;
      console.log("copy is unchanged by writing to the original:", describe(copy) === copyAfter);
      console.log("second copy is unchanged by writing to the original:", describe(secondCopy) === before);
    }
  },

  // Without `which`, every object. In a `bun build --compile --aot` executable Bun ends each of them with a panic:
  // there the private names of an object are where Clone() finds no way to copy them.
  test_v8_object_clone_private_names(which) {
    class WithPrivateField {
      #field = 41;
      visible = 1;
      static has = object => #field in object;
      static read = object => object.#field + 1;
    }
    class WithPrivateMethod {
      visible = 1;
      #method() {
        return 7;
      }
      static has = object => #method in object;
      static read = object => object.#method();
    }
    class WithPrivateAccessor {
      visible = 1;
      get #accessor() {
        return 9;
      }
      static has = object => #accessor in object;
      static read = object => object.#accessor;
    }
    class Derived extends WithPrivateField {
      own = 1;
    }
    class ReturnsItsArgument {
      constructor(object) {
        return object;
      }
    }
    // `new Stamper(object)` gives `object` the private field.
    class Stamper extends ReturnsItsArgument {
      #stamp = 42;
      static has = object => #stamp in object;
      static read = object => object.#stamp;
    }
    const stamped = { visible: 1 };
    new Stamper(stamped);
    // Bun gives the copy of this one each property by definition.
    const withIndexKey = new WithPrivateField();
    withIndexKey[0] = "index key";

    const objects = {
      "a private field": [new WithPrivateField(), WithPrivateField],
      "a private method": [new WithPrivateMethod(), WithPrivateMethod],
      "a private accessor": [new WithPrivateAccessor(), WithPrivateAccessor],
      "an inherited private field": [new Derived(), WithPrivateField],
      "a private field that a constructor gave an object literal": [stamped, Stamper],
      "a private field and an index key": [withIndexKey, WithPrivateField],
    };
    if (which !== undefined && !Object.hasOwn(objects, which)) throw new Error(`unknown object: ${which}`);
    for (const [description, [original, { has, read }]] of Object.entries(objects)) {
      if (which !== undefined && which !== description) continue;
      console.log(`====== object with ${description}`);
      const copy = nativeModule.perform_object_clone(original);
      console.log("Clone() returned");
      console.log("copy is another object:", copy !== original);
      console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
      console.log("own keys of the copy:", Reflect.ownKeys(copy).join(", "));
      console.log("the copy has the private name:", has(copy));
      console.log("read from the copy:", read(copy));
    }
  },

  // In a `bun build --compile --aot` executable Bun makes the properties of these two immutable. The Structure says
  // so from the turn after the one that first reads the object.
  test_v8_object_clone_process_versions_and_release() {
    const describe = object =>
      Reflect.ownKeys(object)
        .map(key => `${String(key)} = ${JSON.stringify(Object.getOwnPropertyDescriptor(object, key))}`)
        .join(", ");
    const objects = [
      ["process.versions", process.versions],
      ["process.release", process.release],
    ];
    setImmediate(() => {
      for (const [name, original] of objects) {
        console.log(`====== ${name}`);
        const copy = nativeModule.perform_object_clone(original);
        console.log("copy is another object:", copy !== original);
        console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
        console.log("own properties as the original's:", describe(copy) === describe(original));
        copy.addedToCopy = true;
        console.log("a property added to the copy is not on the original:", !Object.hasOwn(original, "addedToCopy"));
      }
    });
  },

  test_v8_object_clone_template_instance() {
    for (const [how, useFunctionTemplate] of [
      ["ObjectTemplate::NewInstance()", false],
      ["FunctionTemplate::GetFunction()->NewInstance()", true],
    ]) {
      console.log(`====== object made by ${how}`);
      const [original, copy] = nativeModule.clone_template_instance(useFunctionTemplate);
      console.log("copy is another object:", copy !== original);
      console.log("same prototype:", Object.getPrototypeOf(copy) === Object.getPrototypeOf(original));
      console.log("own keys of the copy:", Object.keys(copy).join(", "));
      console.log("copy.describeInternalFields():", copy.describeInternalFields());
      console.log("original.describeInternalFields():", original.describeInternalFields());

      copy.own = "changed on the copy";
      copy.addedToCopy = true;
      original.addedToOriginal = true;
      console.log("original after writing properties of both:", JSON.stringify(original));
      console.log("copy after writing properties of both:", JSON.stringify(copy));

      // The copy of a copy that JS gave properties of its own.
      const copyOfCopy = nativeModule.perform_object_clone(copy);
      console.log("copy of the copy:", JSON.stringify(copyOfCopy));
      console.log("same prototype:", Object.getPrototypeOf(copyOfCopy) === Object.getPrototypeOf(copy));
      console.log("copyOfCopy.describeInternalFields():", copyOfCopy.describeInternalFields());
      copyOfCopy.own = "changed on the copy of the copy";
      copyOfCopy.addedToCopyOfCopy = true;
      console.log("copy after writing properties of its copy:", JSON.stringify(copy));

      for (const [description, source] of [
        ["the original", original],
        ["the copy", copy],
        ["an object with data properties", { number: 1, string: "two" }],
      ]) {
        try {
          nativeModule.perform_object_clone_with_pending_exception(source);
          console.log(`cloning ${description} did not throw`);
        } catch (e) {
          console.log(`cloning ${description}: caught`, e.message);
        }
      }
    }
  },
});
