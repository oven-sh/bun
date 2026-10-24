const between = (): string => "between";

class Created {
  greet(): string {
    return "first";
  }
}

function greetCreated(f: Created): string {
  return f.greet();
}

{
  const f = new Created();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetCreated(f).length;
  const before = f.greet() + " " + greetCreated(f);
  Object.setPrototypeOf(f, Object.create(Created.prototype, { greet: { value: between, configurable: true } }));
  console.log("Object.create with the members" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetCreated(f) + " | " + (f instanceof Created));
}

class Assigned {
  greet(): string {
    return "first";
  }
}

function greetAssigned(f: Assigned): string {
  return f.greet();
}

{
  const f = new Assigned();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetAssigned(f).length;
  const before = f.greet() + " " + greetAssigned(f);
  Object.setPrototypeOf(f, Object.assign(Object.create(Assigned.prototype), { greet: between }));
  console.log("Object.create and Object.assign" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetAssigned(f) + " | " + (f instanceof Assigned));
}

class Defined {
  greet(): string {
    return "first";
  }
}

function greetDefined(f: Defined): string {
  return f.greet();
}

{
  const f = new Defined();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetDefined(f).length;
  const before = f.greet() + " " + greetDefined(f);
  Object.setPrototypeOf(f, Object.defineProperty(Object.create(Defined.prototype), "greet", { value: between }));
  console.log("Object.create and Object.defineProperty" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetDefined(f) + " | " + (f instanceof Defined));
}

class Literal {
  greet(): string {
    return "first";
  }
}

function greetLiteral(f: Literal): string {
  return f.greet();
}

{
  const f = new Literal();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetLiteral(f).length;
  const before = f.greet() + " " + greetLiteral(f);
  Object.setPrototypeOf(f, { __proto__: Literal.prototype, greet: between });
  console.log("a literal with __proto__" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetLiteral(f) + " | " + (f instanceof Literal));
}

class Hung {
  greet(): string {
    return "first";
  }
}

function greetHung(f: Hung): string {
  return f.greet();
}

{
  const f = new Hung();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetHung(f).length;
  const before = f.greet() + " " + greetHung(f);
  Object.setPrototypeOf(f, Object.setPrototypeOf({ greet: between }, Hung.prototype));
  console.log("a literal handed to Object.setPrototypeOf" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetHung(f) + " | " + (f instanceof Hung));
}

class Instance {
  greet(): string {
    return "first";
  }
}

function greetInstance(f: Instance): string {
  return f.greet();
}

{
  const f = new Instance();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetInstance(f).length;
  const before = f.greet() + " " + greetInstance(f);
  Object.setPrototypeOf(f, new (class extends Instance {
    greet(): string {
      return "between";
    }
  })());
  console.log("an instance of a subclass" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetInstance(f) + " | " + (f instanceof Instance));
}

class Two {
  greet(): string {
    return "first";
  }
}

function greetTwo(f: Two): string {
  return f.greet();
}

{
  const f = new Two();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetTwo(f).length;
  const before = f.greet() + " " + greetTwo(f);
  Object.setPrototypeOf(f, Object.create(Object.create(Two.prototype, { greet: { value: between } })));
  console.log("two links, the upper one created with the members" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetTwo(f) + " | " + (f instanceof Two));
}

class Descriptors {
  greet(): string {
    return "first";
  }
}

function greetDescriptors(f: Descriptors): string {
  return f.greet();
}

{
  const f = new Descriptors();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetDescriptors(f).length;
  const before = f.greet() + " " + greetDescriptors(f);
  Object.setPrototypeOf(f, Object.create(Descriptors.prototype, Object.getOwnPropertyDescriptors({ greet: between })));
  console.log("Object.create with the descriptors of a literal" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetDescriptors(f) + " | " + (f instanceof Descriptors));
}

class Getter {
  greet(): string {
    return "first";
  }
}

function greetGetter(f: Getter): string {
  return f.greet();
}

{
  const f = new Getter();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetGetter(f).length;
  const before = f.greet() + " " + greetGetter(f);
  Object.setPrototypeOf(f, Object.create(Getter.prototype, { greet: { get: () => between } }));
  console.log("Object.create with a getter" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetGetter(f) + " | " + (f instanceof Getter));
}

class Frozen {
  greet(): string {
    return "first";
  }
}

function greetFrozen(f: Frozen): string {
  return f.greet();
}

{
  const f = new Frozen();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetFrozen(f).length;
  const before = f.greet() + " " + greetFrozen(f);
  Object.setPrototypeOf(f, Object.freeze(Object.create(Frozen.prototype, { greet: { value: between } })));
  console.log("a frozen object created with the members" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetFrozen(f) + " | " + (f instanceof Frozen));
}

class Proxied {
  greet(): string {
    return "first";
  }
}

function greetProxied(f: Proxied): string {
  return f.greet();
}

{
  const f = new Proxied();
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += greetProxied(f).length;
  const before = f.greet() + " " + greetProxied(f);
  Object.setPrototypeOf(f, new Proxy(Proxied.prototype, { get: (target, key, receiver) => (key === "greet" ? between : Reflect.get(target, key, receiver)) }));
  console.log("a proxy that answers for the name" + ": " + warm + " | " + before + " | " + f.greet() + " " + greetProxied(f) + " | " + (f instanceof Proxied));
}

export {};
