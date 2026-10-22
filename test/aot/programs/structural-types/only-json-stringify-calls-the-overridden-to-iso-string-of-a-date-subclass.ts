class Stamp extends Date {
  toISOString(): string {
    return "stamp " + this.getTime();
  }
}

console.log(JSON.stringify(new Stamp(5)) + " " + JSON.stringify({ at: new Stamp(6) }));

export {};
