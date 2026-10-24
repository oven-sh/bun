// `// @ts-expect-error` stands above a real type error in the initializer of a constant, in a static field, in a field, in a pattern and in an export, and nothing uses any of them. A build that leaves the declarations out must not call the comments unused.
// @ts-expect-error
const wrongNumber: number = "text";
// @ts-expect-error
const wrongMember = { a: 1 }.b;
class Unused {
  // @ts-expect-error
  static wrong: string = 5;
  // @ts-expect-error
  field: boolean = "no";
}
const unusedObject = {
  // @ts-expect-error
  nested: (1 as number).noSuchMethod,
};
// @ts-expect-error
const [wrongPattern]: [string] = [1];
// @ts-expect-error
export const exportedWrong: string[] = [1, 2];

console.log("built and ran");
