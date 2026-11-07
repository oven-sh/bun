export function identity(arg: any) {
  return arg;
}

export function escape() {
  return "\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C";
}

export function addStrings(arg: string) {
  return arg + "\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C" + "©";
}

export function addStringsUTF16(arg: string) {
  return arg + "\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C" + "😊";
}

export default function() {
  return "defaultdefaultdefault";
}

export async function ireturnapromise() {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => resolve("aaa"), 100);
  return promise;
}

export function symbolKeys() {
  return { v: 2, [Symbol.for("s")]: 1, [Symbol("d")]: 3, [Symbol()]: 4 };
}

export function boxedNumber() {
  return new Number(5);
}

export function boxedBoolean() {
  return new Boolean(false);
}

export function boxedPrimitives() {
  class Celsius extends Number {}
  class Flag extends Boolean {}
  return {
    numbers: [new Number(5), new Number(1.5), new Number(NaN), new Number(Infinity), new Celsius(9)],
    negativeZero: new Number(-0),
    booleans: [new Boolean(true), new Boolean(false), new Flag(false)],
    string: new String("a"),
  };
}

export async function boxedNumberPromise() {
  return new Number(1.5);
}

export function boxedNumberWithValueOf() {
  const number = new Number(5);
  number.valueOf = () => 42;
  return number;
}
