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

const log: string[] = [];

class Config {
  static first: number = Config.readSecond();
  static firstPlusOne: number = Config.readSecond() + 1;
  static firstText: string = Config.readLabel();
  static keysSoFar: string = Object.keys(Config).join("+");
  static {
    log.push("block one: second " + typeof Config.readSecond() + " " + Config.readSecond());
    log.push("block one: label " + typeof Config.readLabel());
    log.push("block one: own second " + Object.hasOwn(Config, "second"));
  }
  static second: number = 2;
  static label: string = "label";
  static {
    log.push("block two: second " + typeof Config.readSecond() + " " + Config.readSecond());
    log.push("block two: label " + Config.readLabel());
  }
  static third: number = Config.readSecond();
  static never: number;
  static neverText: string;
  static neverList: number[];
  static readSecond(): number {
    return Config.second;
  }
  static readLabel(): string {
    return Config.label;
  }
}

for (const entry of log) console.log(entry);
show("first", () => Config.first);
show("firstPlusOne", () => Config.firstPlusOne);
show("firstText", () => Config.firstText);
show("keysSoFar", () => Config.keysSoFar);
show("second", () => Config.second);
show("third", () => Config.third);
show("never", () => Config.never);
show("never + 1", () => Config.never + 1);
show("never | 0", () => Config.never | 0);
show("neverText", () => Config.neverText);
show("neverText.length", () => Config.neverText.length);
show("neverList", () => Config.neverList);
show("neverList.length", () => Config.neverList.length);
show("own never", () => Object.hasOwn(Config, "never"));
show("keys", () => Object.keys(Config).join());

function makeEarly(): string {
  try {
    return String(new Registry().id);
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}
class Registry {
  static early: string = makeEarly();
  static instance: Registry = new Registry();
  static next: number = 100;
  id: number = Registry.next++;
}
show("an instance made by a function in a static initializer", () => Registry.early);
show("an instance made before the counter is set: id", () => Registry.instance.id);
show("typeof", () => typeof Registry.instance.id);
show("next", () => Registry.next);
show("an instance made afterwards", () => new Registry().id);
show("next", () => Registry.next);

class Parent {
  static kind: string = "parent";
  static describe(): string {
    return this.kind + " " + this.size();
  }
  static size(): number {
    return 0;
  }
  static described: string = Parent.describe();
}
class Child extends Parent {
  static described: string = Child.describe();
  static kind: string = "child";
  static width: number = 4;
  static size(): number {
    return this.width;
  }
  static describedAgain: string = Child.describe();
}
show("parent", () => Parent.described);
show("child, too early", () => Child.described);
show("child, in time", () => Child.describedAgain);
