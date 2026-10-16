import { Base, Full } from "./base.ts";
export function heirsOf(Parent) {
  class Fields extends Parent {
    a = 1;
    b = "two";
    c = [3];
    d = { four: 4 };
    e = null;
  }
  class Many extends Parent {
    p0 = 0; p1 = 1; p2 = 2; p3 = 3; p4 = 4; p5 = 5; p6 = 6; p7 = 7; p8 = 8; p9 = 9;
  }
  class WithSetter extends Parent {
    constructor(options, stores) {
      super(options);
      this.caught = "nothing";
      if (stores) this.guarded = "stored";
    }
    set guarded(value) {
      this.caught = "caught " + value;
    }
    get guarded() {
      return "from the getter";
    }
  }
  class DefinesOverSetter extends WithSetter {
    guarded = "defined";
  }
  class StoresThenDefines extends Parent {
    constructor(options) {
      super(options);
      this.plain = "stored after";
    }
    plain = "defined";
  }
  class Hidden extends Parent {
    constructor(options) {
      super(options);
      Object.defineProperty(this, "secret", { value: "hidden", enumerable: false, writable: true, configurable: true });
    }
  }
  class Reveals extends Hidden {
    secret = "revealed";
  }
  class Closed extends Parent {
    constructor(options, closes) {
      super(options);
      if (closes) Object.preventExtensions(this);
    }
  }
  class DefinesOnClosed extends Closed {
    extra = "extra";
  }
  class ReadOnlyAbove extends Parent {}
  Object.defineProperty(ReadOnlyAbove.prototype, "fixed", { value: "above", writable: false, configurable: true });
  class DefinesOverReadOnly extends ReadOnlyAbove {
    fixed = "own";
  }
  return { Fields, Many, DefinesOverSetter, StoresThenDefines, Reveals, DefinesOnClosed, DefinesOverReadOnly };
}
export class DefinesDeclared extends Base {
  late = "defined late";
  count = 7;
}
export class DefinesBorn extends Base {
  url = "/defined";
}
export class DefinesDeclaredOverSetter extends Base {}
Object.defineProperty(DefinesDeclaredOverSetter.prototype, "late", {
  set(value) {
    this.caught = "caught " + value;
  },
  configurable: true,
});
export class DefinesDeclaredBelowSetter extends DefinesDeclaredOverSetter {
  late = "defined below a setter";
}
export const parents = { Base, Full };
