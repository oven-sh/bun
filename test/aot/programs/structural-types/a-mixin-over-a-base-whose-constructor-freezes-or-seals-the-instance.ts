function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Frozen {
  kept = 1;
  constructor() {
    Object.freeze(this);
  }
}

class Sealed {
  kept = 1;
  constructor() {
    Object.seal(this);
  }
}

class Closed {
  kept = 1;
  constructor() {
    Object.preventExtensions(this);
  }
}

class Open {
  kept = 1;
}

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

for (const Base of [Open, Frozen, Sealed, Closed, Open]) {
  try {
    console.log(Base.name + ": " + describe(new (Tagged(Base))()));
  } catch (error) {
    console.log(Base.name + ": threw a TypeError: " + (error instanceof TypeError));
  }
}
