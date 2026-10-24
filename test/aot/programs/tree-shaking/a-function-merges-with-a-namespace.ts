// A function and a namespace of one name are one value. The function calls a member of the namespace, the namespace calls the function and a helper, and the program names only the merged name. The same for a class and for an enum.
function helper() { return "helper"; }

function parse(text: string): string { return parse.prefix + text + parse.suffix(); }
namespace parse {
  export const prefix = "<";
  export function suffix() { return ">" + helper(); }
  export function twice(text: string) { return parse(parse(text)); }
}

class Color {
  constructor(public name: string) {}
  describe() { return Color.label(this); }
}
namespace Color {
  export function label(color: Color) { return "color " + color.name; }
  export const red = new Color("red");
}

enum Level { Low = 1, High = 2 }
namespace Level {
  export function describe(level: Level) { return Level[level] + " " + levelHelper(); }
}
function levelHelper() { return "level"; }

console.log(parse("a"), parse.twice("b"));
console.log(Color.red.describe());
console.log(Level.describe(Level.High));
