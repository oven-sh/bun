const log: string[] = [];

class Vowels {
  [Symbol.replace](text: string, replacement: string): string {
    log.push("replace");
    return text
      .split("")
      .map(c => ("aeiou".includes(c) ? replacement : c))
      .join("");
  }
  [Symbol.search](text: string): number {
    log.push("search");
    for (let i = 0; i < text.length; i++) if ("aeiou".includes(text[i])) return i;
    return -1;
  }
  [Symbol.split](text: string, limit?: number): string[] {
    log.push("split " + limit);
    return [text.slice(0, 1), text.slice(1)];
  }
  [Symbol.match](text: string): RegExpMatchArray | null {
    log.push("match");
    return text.match("e");
  }
}

function replaceIn(text: string, v: Vowels): string {
  return text.replace(v, "*");
}

function all(text: string, v: Vowels): string {
  const found = text.match(v);
  return [replaceIn(text, v), text.search(v), text.split(v).join("|"), text.split(v, 1).join("|"), found === null ? "null" : found[0] + "@" + found.index].join(" ");
}

function round(label: string, v: Vowels): void {
  log.length = 0;
  console.log(label + ": " + all("hello", v) + " [" + log.join(", ") + "]");
}

const v = new Vowels();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += replaceIn("hello", v).length + "hello".search(v);
console.log("2000 honest: " + warm);
round("the class's methods", v);

export {};
