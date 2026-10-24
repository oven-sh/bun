class Player {
  name: string;
  score = 0;
  constructor(name: string) {
    this.name = name;
  }
  win(points: number): string {
    this.score += points;
    return this.name + " has " + this.score;
  }
  lend(): (points: number) => string {
    return points => this.win(points);
  }
  lendDirect(): (points: number) => string {
    return points => {
      this.score += points * 2;
      return "twice for " + this.name + ": " + this.score;
    };
  }
}

function winFor(p: Player): string {
  return p.win(1);
}

function state(...players: Player[]): string {
  return players.map(p => p.name + "=" + p.score).join(" ");
}

const ann = new Player("ann");
const bob = new Player("bob");
for (let i = 0; i < 2000; i++) {
  winFor(ann);
  winFor(bob);
}
console.log("2000 honest: " + state(ann, bob));
ann.score = 0;
bob.score = 0;

ann.win = bob.lendDirect();
console.log("ann's win is an arrow made by bob: " + ann.win(1) + " | " + winFor(ann) + " | " + state(ann, bob));

ann.win = bob.lend();
console.log("an arrow that calls bob's method: " + ann.win(1) + " | " + winFor(ann) + " | " + state(ann, bob));

bob.win = ann.lendDirect();
console.log("bob's is an arrow made by ann: " + bob.win(1) + " | " + winFor(bob) + " | " + state(ann, bob));
console.log("ann's arrow now reaches ann through bob: " + ann.win(1) + " | " + winFor(ann) + " | " + state(ann, bob));

console.log("call with another this changes nothing: " + ann.win.call(new Player("cy"), 1) + " | " + state(ann, bob));

Reflect.deleteProperty(ann, "win");
Reflect.deleteProperty(bob, "win");
console.log("uncovered: " + winFor(ann) + " | " + winFor(bob) + " | " + state(ann, bob));

const original = Player.prototype.win;
const keeper = new Player("keeper");
Player.prototype.win = keeper.lendDirect();
console.log("on the prototype: " + winFor(ann) + " | " + bob.win(1) + " | " + new Player("new").win(1) + " | " + state(ann, bob, keeper));
Player.prototype.win = original;
console.log("put back: " + winFor(ann) + " | " + bob.win(1) + " | " + state(ann, bob, keeper));

export {};
