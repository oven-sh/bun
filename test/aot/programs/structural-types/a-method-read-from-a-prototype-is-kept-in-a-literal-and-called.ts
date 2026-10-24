class Tool {
  count(n: number): string {
    return "count " + n;
  }
}

const kept = { measure: Tool.prototype.count };
console.log(kept.measure(1));

export {};
