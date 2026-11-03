// The driver of v8::Object::GetOwnPropertyNames(), apart from the others for the reason that object-clone.js gives.
module.exports = nativeModule => ({
  test_v8_object_get_own_property_names() {
    // v8::PropertyFilter
    const ALL_PROPERTIES = 0;
    const ONLY_WRITABLE = 1;
    const ONLY_ENUMERABLE = 2;
    const ONLY_CONFIGURABLE = 4;
    const SKIP_STRINGS = 8;
    const SKIP_SYMBOLS = 16;
    const filterBits = { ONLY_WRITABLE, ONLY_ENUMERABLE, ONLY_CONFIGURABLE, SKIP_STRINGS, SKIP_SYMBOLS };
    // v8::KeyConversionMode
    const kConvertToString = 0;
    const kKeepNumbers = 1;
    const kNoNumbers = 2;
    const conversionNames = ["kConvertToString", "kKeepNumbers", "kNoNumbers"];

    class TrapError extends Error {}

    const describeFilter = filter =>
      Object.keys(filterBits)
        .filter(name => filter & filterBits[name])
        .join("|") || "ALL_PROPERTIES";
    const describeKey = key =>
      typeof key === "symbol" ? `symbol(${key.description})` : `${typeof key} ${JSON.stringify(key)}`;

    // Without a filter the one-argument overload is called, without a conversion the default argument is used.
    function getNames(object, filter, conversion) {
      const args = [object];
      if (filter !== undefined) args.push(filter);
      if (conversion !== undefined) args.push(conversion);
      return nativeModule.perform_get_own_property_names(...args);
    }

    function show(description, object, filter, conversion) {
      let line = `${description}, ${filter === undefined ? "one-argument overload" : describeFilter(filter)}`;
      if (conversion !== undefined) line += `, ${conversionNames[conversion]}`;
      let names;
      try {
        names = getNames(object, filter, conversion);
      } catch (e) {
        // only the errors thrown by this test have a message that is the same in every engine
        console.log(`${line}: threw ${e instanceof TrapError ? `TrapError: ${e.message}` : e.constructor.name}`);
        return;
      }
      if (Array.isArray(names)) console.log(`${line}: ${names.length} [${names.map(describeKey).join(", ")}]`);
      else console.log(`${line}: returned ${typeof names}`);
    }

    const symbols = {
      enumerable: Symbol("enumerable"),
      hidden: Symbol("hidden"),
      readOnly: Symbol("readOnly"),
      nonConfigurable: Symbol("nonConfigurable"),
    };
    // A getter that runs shows up as an exception: listing the keys must not read any value.
    const accessor = {
      get() {
        throw new TrapError("a getter ran");
      },
      set() {
        throw new TrapError("a setter ran");
      },
    };
    function createMixedObject() {
      const object = {};
      object.b = 1;
      object[7] = 1;
      object[symbols.enumerable] = 1;
      object.a = 1;
      object[2] = 1;
      const define = (key, descriptor) => Object.defineProperty(object, key, descriptor);
      define("hidden", { value: 1, writable: true, enumerable: false, configurable: true });
      define("readOnly", { value: 1, writable: false, enumerable: true, configurable: true });
      define("nonConfigurable", { value: 1, writable: true, enumerable: true, configurable: false });
      define("frozen", { value: 1, writable: false, enumerable: false, configurable: false });
      define("getter", { get: accessor.get, enumerable: true, configurable: true });
      define("setter", { set: accessor.set, enumerable: true, configurable: true });
      define("hiddenGetter", { get: accessor.get, enumerable: false, configurable: true });
      define("fixedAccessor", { ...accessor, enumerable: true, configurable: false });
      define(symbols.hidden, { value: 1, writable: true, enumerable: false, configurable: true });
      define(symbols.readOnly, { value: 1, writable: false, enumerable: true, configurable: true });
      define(symbols.nonConfigurable, { value: 1, writable: true, enumerable: true, configurable: false });
      define(5, { value: 1, writable: true, enumerable: false, configurable: true });
      define(4, { value: 1, writable: false, enumerable: true, configurable: true });
      define(3, { value: 1, writable: true, enumerable: true, configurable: false });
      define(1, { get: accessor.get, enumerable: true, configurable: true });
      object.z = 1;
      return object;
    }

    console.log("====== every filter on an object with index, string, accessor and symbol keys");
    const mixed = createMixedObject();
    show("mixed", mixed);
    for (let filter = ALL_PROPERTIES; filter <= 31; filter++) show("mixed", mixed, filter);

    console.log("====== key conversion");
    // kNoNumbers tells V8 to expect no index keys. Only a debug build of V8 checks that: the keys stay numbers.
    for (const filter of [ALL_PROPERTIES, ONLY_ENUMERABLE | SKIP_SYMBOLS, SKIP_STRINGS]) {
      for (const conversion of [kConvertToString, kKeepNumbers, kNoNumbers]) show("mixed", mixed, filter, conversion);
    }
    show("string keys only", { b: 1, a: 1 }, ALL_PROPERTIES, kNoNumbers);

    console.log("====== which keys are indices");
    // 4294967294 is the largest array index
    const limits = { name: 1 };
    for (const key of "4294967295 4294967294 2147483648 10 9 0 -1 -0 01 1.5 1e3".split(" ")) limits[key] = 1;
    show("limits", limits);
    for (const conversion of [kConvertToString, kKeepNumbers, kNoNumbers]) {
      show("limits", limits, ALL_PROPERTIES, conversion);
    }

    console.log("====== own keys only");
    const prototype = { inherited: 1, 3: 1, [Symbol("inherited")]: 1 };
    const derived = Object.create(prototype);
    derived.own = 1;
    derived[8] = 1;
    show("object with a prototype", derived);
    show("object with a prototype", derived, ALL_PROPERTIES);
    class WithPrivateField {
      #hidden = 1;
      visible = this.#hidden;
    }
    show("class instance with a private field", new WithPrivateField(), ALL_PROPERTIES);
    show("empty object", {});
    show("empty object", {}, ALL_PROPERTIES);
    show("object without a prototype", Object.assign(Object.create(null), { x: 1, 0: 1 }), ALL_PROPERTIES);

    // Not covered: ONLY_WRITABLE and ONLY_CONFIGURABLE on a frozen or sealed object with index keys. V8 lists those index keys only if the elements were dense when the object was frozen or sealed. Bun filters them like other keys.
    console.log("====== frozen and sealed objects");
    const frozen = Object.freeze({ a: 1, [symbols.enumerable]: 1 });
    const sealed = Object.seal({ a: 1, [symbols.enumerable]: 1 });
    for (const filter of [ALL_PROPERTIES, ONLY_WRITABLE, ONLY_CONFIGURABLE]) {
      show("frozen object", frozen, filter);
      show("sealed object", sealed, filter);
    }
    const frozenArray = Object.freeze(["a", "b"]);
    show("frozen array", frozenArray);
    show("frozen array", frozenArray, ALL_PROPERTIES);

    console.log("====== arrays");
    const elementAttributes = ["a", "b", "c", "d"];
    Object.defineProperty(elementAttributes, 1, { writable: false });
    Object.defineProperty(elementAttributes, 2, { enumerable: false });
    Object.defineProperty(elementAttributes, 3, { configurable: false });
    for (const filter of [undefined, ALL_PROPERTIES, ONLY_WRITABLE, ONLY_ENUMERABLE, ONLY_CONFIGURABLE, SKIP_STRINGS]) {
      show("array with element attributes", elementAttributes, filter);
    }
    show("Uint8Array", new Uint8Array(3), ALL_PROPERTIES, kConvertToString);

    console.log("====== symbols");
    const symbolKeys = [Symbol.iterator, Symbol.for("registered"), Symbol(), Symbol("")];
    const withSymbols = { string: 1 };
    for (const symbol of symbolKeys) withSymbols[symbol] = 1;
    show("symbol keys", withSymbols, SKIP_STRINGS);
    const sameSymbols = getNames(withSymbols, SKIP_STRINGS).every((symbol, i) => symbol === symbolKeys[i]);
    console.log("the same symbols:", sameSymbols);

    console.log("====== Proxy");
    const noTraps = new Proxy(createMixedObject(), {});
    for (const filter of [undefined, ALL_PROPERTIES, ONLY_ENUMERABLE]) show("proxy without traps", noTraps, filter);
    const throwsFromOwnKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new TrapError("ownKeys threw");
        },
      },
    );
    show("proxy with a throwing ownKeys trap", throwsFromOwnKeys, ALL_PROPERTIES);
  },
});
