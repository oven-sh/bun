class Returns {
  constructor(o: object) {
    return o;
  }
}

class Stamp extends Returns {
  #mark = 1;
  static marked(o: object): boolean {
    return #mark in o;
  }
}

class Circle {
  radius = 5;
}

const circle = new Circle();
new Stamp(circle);
console.log(Stamp.marked(circle));
