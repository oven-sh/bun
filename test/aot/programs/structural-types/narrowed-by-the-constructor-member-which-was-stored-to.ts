function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

function make(square: boolean): Shape | Square {
  return square ? new Square() : new Shape();
}

const own = make(false);
own.constructor = Square;
if (own.constructor === Square) {
  say("an own member: edge", own.edge);
  say("an own member: edge doubled", own.edge * 2);
  say("an own member: sides", own.sides);
  say("an own member: instanceof", own instanceof Square);
}

const real = make(true);
if (real.constructor === Square) {
  say("a real square: edge", real.edge);
}

class Round {
  sides = 0;
}

class Disk extends Round {
  radius = 3;
}

function makeRound(disk: boolean): Round | Disk {
  return disk ? new Disk() : new Round();
}

Round.prototype.constructor = Disk;
const round = makeRound(false);
if (round.constructor === Disk) {
  say("on the prototype: radius", round.radius);
  say("on the prototype: radius doubled", round.radius * 2);
  say("on the prototype: sides", round.sides);
}
