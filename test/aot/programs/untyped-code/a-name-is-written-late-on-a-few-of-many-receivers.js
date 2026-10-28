// One read site sees objects of twelve classes. Some of the names it reads are on none of them at first and are stored later, by functions that are found step by step.
const all = [];
class C0 {
  constructor() {
    this.own0 = 0;
  }
}
class C1 {
  constructor() {
    this.own1 = 1;
  }
}
class C2 {
  constructor() {
    this.own2 = 2;
  }
}
class C3 {
  constructor() {
    this.own3 = 3;
  }
}
class C4 {
  constructor() {
    this.own4 = 4;
  }
}
class C5 {
  constructor() {
    this.own5 = 5;
  }
}
class C6 {
  constructor() {
    this.own6 = 6;
  }
}
class C7 {
  constructor() {
    this.own7 = 7;
  }
}
class C8 {
  constructor() {
    this.own8 = 8;
  }
}
class C9 {
  constructor() {
    this.own9 = 9;
  }
}
class C10 {
  constructor() {
    this.own10 = 10;
  }
}
class C11 extends C10 {
  constructor() {
    super();
    this.own11 = 11;
  }
}
for (const made of [C0, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11]) all.push(new made());

const show = value => (typeof value === "function" ? "function " + value.call({ tag: "receiver" }) : String(value));
const readLate = object => object.late;
const readNever = object => object.never;
const readOwn = object => object.own7;
const readInherited = object => object.inherited;
const readComputed = object => object.computed;
const readGetter = object => object.got;
function print(title) {
  console.log(title);
  for (const read of [readLate, readNever, readOwn, readInherited, readComputed, readGetter])
    console.log(" ", all.map(read).map(show).join(" "));
}

const steps = {
  first() {
    all[5].late = "five";
    return steps.second;
  },
  second() {
    C10.prototype.inherited = function () {
      return this.tag;
    };
    return steps.third;
  },
  third() {
    all[2]["comp" + (all.length > 3 ? "uted" : "")] = "by key";
    return steps.fourth;
  },
  fourth() {
    Object.defineProperty(all[9], "got", {
      get() {
        return "got " + this.own9;
      },
      configurable: true,
    });
    return steps.fifth;
  },
  fifth() {
    all[0].late = { toString: () => "zero" };
    delete all[5].late;
    return null;
  },
};

print("at first");
for (let step = steps.first; step; step = step()) print("after a step");
