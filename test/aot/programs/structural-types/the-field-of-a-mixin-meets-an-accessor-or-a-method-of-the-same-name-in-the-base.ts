function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class WithSetter {
  get tag(): string {
    return "getter of the base";
  }
  set tag(value: string) {
    seen.push("setter of the base: " + value);
  }
}

class WithMethodNamedTag {
  tag(): string {
    return "a method of the base";
  }
}

function FieldOverAccessor(Base: new () => object) {
  return class extends Base {
    tag = "field of the mixin";
  };
}

for (const Base of [WithSetter, WithMethodNamedTag, Object]) {
  const made = new (FieldOverAccessor(Base))();
  console.log(Base.name + ": " + describe(made) + " tag " + made.tag + " own " + Object.hasOwn(made, "tag"));
}
console.log("seen: [" + seen.join(", ") + "]");
