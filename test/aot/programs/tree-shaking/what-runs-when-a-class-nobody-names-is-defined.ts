// Nothing names these classes, yet defining them runs the expression after extends, the computed keys of methods, accessors and fields. Those hold the only references to these functions.
const log: string[] = [];
function base() { log.push("extends"); return Object; }
function methodKey() { log.push("key of a method"); return "a"; }
function getterKey() { log.push("key of a getter"); return "b"; }
function staticKey() { log.push("key of a static method"); return "c"; }
function generatorKey() { log.push("key of a generator"); return "e"; }

class WithHeritage extends base() {
  method() { return 1; }
}

class WithKeys {
  [methodKey()]() { return 1; }
  get [getterKey()]() { return 1; }
  static [staticKey()]() { return 1; }
  *[generatorKey()]() {}
  plain() { return 1; }
}

console.log(log.join(", "));
