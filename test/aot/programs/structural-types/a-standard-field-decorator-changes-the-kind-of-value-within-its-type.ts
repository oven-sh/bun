function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function emptied(target: undefined, context: ClassFieldDecoratorContext<Holder, number | string>) {
  return function (this: Holder, initial: number | string): number | string {
    return typeof initial === "number" ? "was " + initial : initial.length;
  };
}

class Holder {
  @emptied a: number | string = 1;
  @emptied b: number | string = "four";
  plain: number | string = 2;
  show(): string {
    return typeof this.a + " " + this.a + " " + typeof this.b + " " + this.b + " " + typeof this.plain;
  }
}

console.log(describe(new Holder()));
console.log(new Holder().show());
