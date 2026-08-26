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

export default function () {
  return "defaultdefaultdefault";
}

export async function ireturnapromise() {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => resolve("aaa"), 100);
  return promise;
}

export function bigints() {
  return { big: 2n ** 64n + 1n, negative: -(2n ** 70n), zero: 0n, nested: [1n, { two: 2n }] };
}
