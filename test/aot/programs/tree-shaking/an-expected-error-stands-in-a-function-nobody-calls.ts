// `// @ts-expect-error` is itself an error where the next line has none. Here each stands above a real type error, inside a function, an arrow function, a method and a constructor that nobody calls. A build that does not look into those bodies must not call the comments unused.
function unusedFunction(): number {
  // @ts-expect-error
  const wrong: number = "text";
  return wrong;
}
const unusedArrow = (): string => {
  // @ts-expect-error
  return 5;
};
class Unused {
  field: number;
  constructor() {
    // @ts-expect-error
    this.field = "text";
  }
  method(): boolean {
    // @ts-expect-error
    return this.field.noSuchMember;
  }
}
export function unusedExport(): void {
  // @ts-expect-error
  unusedFunction("too", "many");
}

console.log("built and ran");
