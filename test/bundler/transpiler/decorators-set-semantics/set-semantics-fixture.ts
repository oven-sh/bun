// @ts-nocheck
// Run by decorators.test.ts with this directory as the working directory, so
// this directory's tsconfig.json applies: experimentalDecorators with
// useDefineForClassFields: false. Decorated field initializers then use
// [[Set]] semantics and run the accessors the decorators define.
function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${String(expected)} but received ${String(actual)}`);
      }
    },
  };
}

class IceCreamComponent {
  @Emoji()
  flavor = "vanilla";
}

// Property Decorator
function Emoji() {
  return function (target: Object, key: string | symbol) {
    let val = target[key];

    const getter = () => {
      return val;
    };
    const setter = next => {
      val = `🍦 ${next} 🍦`;
    };

    Object.defineProperty(target, key, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}

const iceCream = new IceCreamComponent();
expect(iceCream.flavor).toBe("🍦 vanilla 🍦");
iceCream.flavor = "chocolate";
expect(iceCream.flavor).toBe("🍦 chocolate 🍦");

// No instance field below has a computed key: with useDefineForClassFields
// false, one such key keeps every instance field of the class native.

const h: unique symbol = Symbol.for("h");
const q: unique symbol = Symbol.for("q");
const u3: unique symbol = Symbol.for("u3");
const u8: unique symbol = Symbol.for("u8");

class S {
  @StringAppender("😛") k = 35;
  @StringAppender("🤠") static j = 4;
  @StringAppender("😵‍💫") private static [h] = 30;
  @StringAppender("🤯") private static u = 60;
  @StringAppender("🎃") private e = 10;
  @StringAppender("👻") static [q] = 202;
  @StringAppender("😇") r = S[h];
  _y: number;
  @StringAppender("🤡") get y() {
    return this._y;
  }
  set y(next) {
    this._y = next;
  }
  #o = 100;

  @StringAppender("😍") u1: number;
  @StringAppender("🥳") static u2: number;
  @StringAppender("🤓") private static [u3]: number;
  @StringAppender("🥺") private static u4: number;
  @StringAppender("☹️") private u7: number;
  @StringAppender("🙃") static [u8]: number;

  @StringAppender("🤔") u9 = this.u1;
  @StringAppender("🤨") u10 = this.u2;
  @StringAppender("🙂") u11 = S[u3];
  @StringAppender("🙁") u12 = S.u4;
  @StringAppender("😶") u15 = this.u7;
  @StringAppender("😏") u16 = S[u8];

  constructor() {
    this.k = 3;
    expect(this.k).toBe("3 😛");
    expect(S.j).toBe(4);
    expect(this.e).toBe("10 🎃");
    expect(S[h]).toBe(30);
    expect(S.u).toBe(60);
    expect(S[q]).toBe(202);
    expect(this.#o).toBe(100);
    expect(this.r).toBe("30 😇");
    expect(this.y).toBe(undefined);
    this.y = 100;
    expect(this.y).toBe(100);

    expect(this.u1).toBe(undefined);
    expect(S.u2).toBe(undefined);
    expect(S[u3]).toBe(undefined);
    expect(S.u4).toBe(undefined);
    expect(this.u7).toBe(undefined);
    expect(S[u8]).toBe(undefined);

    expect(this.u9).toBe("undefined 🤔");
    expect(this.u10).toBe("undefined 🤨");
    expect(this.u11).toBe("undefined 🙂");
    expect(this.u12).toBe("undefined 🙁");
    expect(this.u15).toBe("undefined 😶");
    expect(this.u16).toBe("undefined 😏");

    this.u1 = 100;
    expect(this.u1).toBe("100 😍");
    S.u2 = 100;
    expect(S.u2).toBe("100 🥳");
    S[u3] = 100;
    expect(S[u3]).toBe("100 🤓");
    S.u4 = 100;
    expect(S.u4).toBe("100 🥺");
    this.u7 = 100;
    expect(this.u7).toBe("100 ☹️");
    S[u8] = 100;
    expect(S[u8]).toBe("100 🙃");

    expect(this.u9).toBe("undefined 🤔");
    expect(this.u10).toBe("undefined 🤨");
    expect(this.u11).toBe("undefined 🙂");
    expect(this.u12).toBe("undefined 🙁");
    expect(this.u15).toBe("undefined 😶");
    expect(this.u16).toBe("undefined 😏");
  }
}

let s = new S();
expect(s.u9).toBe("undefined 🤔");
expect(s.u10).toBe("undefined 🤨");
expect(s.u11).toBe("undefined 🙂");
expect(s.u12).toBe("undefined 🙁");
expect(s.u15).toBe("undefined 😶");
expect(s.u16).toBe("undefined 😏");

s.u9 = 35;
expect(s.u9).toBe("35 🤔");
s.u10 = 36;
expect(s.u10).toBe("36 🤨");
s.u11 = 37;
expect(s.u11).toBe("37 🙂");
s.u12 = 38;
expect(s.u12).toBe("38 🙁");
s.u15 = 41;
expect(s.u15).toBe("41 😶");
s.u16 = 42;
expect(s.u16).toBe("42 😏");

function StringAppender(emoji: string) {
  return function (target: Object, key: string | symbol) {
    let val = target[key];

    const getter = () => {
      return val;
    };
    const setter = value => {
      val = `${value} ${emoji}`;
    };

    Object.defineProperty(target, key, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}

console.log("ok");
