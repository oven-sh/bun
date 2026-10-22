const log: string[] = [];

class Loud extends RegExp {
  exec(text: string): RegExpExecArray | null {
    log.push("exec");
    return super.exec(text);
  }
  get flags(): string {
    log.push("flags");
    return super.flags;
  }
}

console.log("a-b-c".replace(new Loud("-", "g"), "+") + " " + "a-b".split(new Loud("-")).join("|") + " " + new Loud("b").test("abc") + " [" + [...new Set(log)].join(", ") + "]");

export {};
