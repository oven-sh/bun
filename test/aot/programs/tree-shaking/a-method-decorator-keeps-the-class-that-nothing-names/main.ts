// With experimentalDecorators a method decorator gets the prototype, a static one the constructor, a property decorator and a parameter decorator the prototype too. Each keeps what it got; the classes are named nowhere.
const kept: [string, any][] = [];

function keep(label: string) {
  return (target: any, ...rest: unknown[]): void => {
    kept.push([label, typeof target === "function" ? target : target.constructor]);
  };
}

class ByMethod {
  @keep("method") marked(): void {}
  run(): string {
    return "by method";
  }
}

class ByStaticMethod {
  @keep("static method") static marked(): void {}
  run(): string {
    return "by static method";
  }
}

class ByProperty {
  @keep("property") marked = 1;
  run(): string {
    return "by property " + this.marked;
  }
}

class ByParameter {
  marked(@keep("parameter") value: number): void {}
  run(): string {
    return "by parameter";
  }
}

class ByAccessor {
  @keep("accessor") get marked(): number {
    return 1;
  }
  run(): string {
    return "by accessor " + this.marked;
  }
}

for (const [label, constructor] of kept) console.log(label + ": " + new constructor().run());
