function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Whole {
  n: number = 0;
  read(): number {
    return this.n;
  }
  isSet(): boolean {
    return this.n !== undefined;
  }
}
class Fraction {
  n: number = 0.5;
  read(): number {
    return this.n;
  }
  isSet(): boolean {
    return this.n !== undefined;
  }
}
class Byte {
  n: number = 0;
  flag: boolean = false;
  set(v: number): void {
    this.n = v & 255;
  }
  read(): number {
    return this.n;
  }
}
class Flags {
  a: boolean = false;
  b: boolean = true;
  c: boolean = false;
}

const values: number[] = [
  0,
  -0,
  1,
  -1,
  127,
  128,
  -128,
  -129,
  255,
  256,
  32767,
  32768,
  -32768,
  65535,
  65536,
  2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967295,
  4294967296,
  9007199254740991,
  9007199254740992,
  -9007199254740991,
  5e-324,
  1.7976931348623157e308,
  Infinity,
  -Infinity,
  NaN,
  0.1,
  1e21,
];

function exact(n: number): string {
  return typeof n + " " + (Object.is(n, -0) ? "-0" : String(n));
}

const whole = new Whole();
const fraction = new Fraction();
for (const value of values) {
  whole.n = value;
  fraction.n = value;
  const label = exact(value);
  show(label + " in the whole field", () => exact(whole.read()) + " " + whole.isSet() + " " + Object.is(whole.n, value));
  show(label + " in the fraction field", () => exact(fraction.read()) + " " + fraction.isSet() + " " + Object.is(fraction.n, value));
  show(label + " keys", () => Object.keys(whole).join() + " " + JSON.stringify(whole));
}

const byte = new Byte();
const seen: number[] = [];
for (let i = 0; i < 260; i += 13) {
  byte.set(i * 5);
  seen.push(byte.read());
}
show("bytes", () => seen.join());
byte.n = 255;
show("255", () => exact(byte.read()));
byte.n++;
show("256", () => exact(byte.read()));
byte.n = -1;
show("-1", () => exact(byte.read()));
byte.n = 0.5;
show("0.5", () => exact(byte.read()));
show("flag is untouched", () => byte.flag);

whole.n = 2147483647;
whole.n++;
show("past the largest int32 by ++", () => exact(whole.read()));
whole.n = -2147483648;
whole.n--;
show("past the smallest int32 by --", () => exact(whole.read()));
whole.n = 65536;
whole.n *= 65536;
show("past int32 by *=", () => exact(whole.read()));
whole.n = 0;
whole.n *= -1;
show("-0 by *=", () => exact(whole.read()));
whole.n = -4;
whole.n %= 2;
show("-0 by %=", () => exact(whole.read()));
whole.n = -1;
whole.n >>>= 0;
show(">>>= 0", () => exact(whole.read()));
whole.n = 1;
whole.n /= 3;
show("/= 3", () => exact(whole.read()));

const flags = new Flags();
show("flags", () => JSON.stringify(flags));
flags.a = true;
flags.c = !flags.b;
show("flags", () => JSON.stringify(flags));
