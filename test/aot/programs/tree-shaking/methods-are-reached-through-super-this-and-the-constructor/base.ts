export interface Speaker {
  speak(): string;
}
function decorate(text: string) { return "*" + text + "*"; }

export class Base implements Speaker {
  name = "base";
  viaSuper() { return decorate("viaSuper of Base"); }
  hidden() { return decorate("hidden"); }
  dispatch(name: string): string { return (this as any)[name](); }
  viaConstructor() { return (this.constructor as typeof Base).describeStatic(); }
  static describeStatic() { return decorate("static of " + this.name); }
  inheritedOnly() { return decorate("inherited only"); }
  speak() { return decorate(this.name + " speaks"); }
}
