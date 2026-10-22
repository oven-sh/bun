function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class First extends Point {
  first = "f1";
}

class Second extends First {
  second = "s2";
}

class Third extends Second {
  third = "t3";
}

console.log("one: " + describe(new First()));
console.log("two: " + describe(new Second()));
console.log("three: " + describe(new Third()));
const made = new Third();
console.log("members: " + made.x + " " + made.y + " " + made.first + " " + made.second + " " + made.third + " " + made.sum());
console.log("instance of Point: " + (made instanceof Point));
