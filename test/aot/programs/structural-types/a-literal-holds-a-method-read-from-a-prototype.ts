class Tool {
  count(n: number): string {
    return "count " + n;
  }
  measure(n: number): string {
    return "measure " + n;
  }
}

Object.assign(Tool.prototype, { measure: Tool.prototype.count });
console.log(new Tool().measure(1));

export {};
