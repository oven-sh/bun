class Words extends Array<string> {
  join(separator?: string): string {
    return "joined by the subclass with " + separator;
  }
}

const words = new Words();
words.push("a", "b");
console.log(String(words) + " | " + `${words}` + " | " + words.toString() + " | " + ("" + words));

export {};
