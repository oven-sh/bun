class Jumping {
  height = 0;
  jump(): string {
    this.height++;
    return "jumped to " + this.height;
  }
}

class Ducking {
  ducked = false;
  duck(): string {
    this.ducked = !this.ducked;
    return "ducked " + this.ducked;
  }
  get low(): boolean {
    return this.ducked;
  }
}

class Sprite {
  x = 0;
  height = 10;
  ducked = false;
  move(): string {
    return "moved to " + ++this.x;
  }
  jump(): string {
    return "the sprite's own jump";
  }
}

interface Sprite extends Jumping, Ducking {}

function copyMembers(target: { prototype: object }, sources: { prototype: object }[]): string[] {
  const copied: string[] = [];
  for (const source of sources) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(source.prototype, name);
      if (descriptor) Object.defineProperty(target.prototype, name, descriptor);
      copied.push(name);
    }
  }
  return copied;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function jumpOf(s: Sprite): string {
  return s.jump();
}

function duckOf(s: Sprite): string {
  return s.duck() + " " + s.low;
}

function jumpingJump(j: Jumping): string {
  return j.jump();
}

const s = new Sprite();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += jumpOf(s).length + s.move().length + jumpingJump(new Jumping()).length;
console.log("2000 honest: " + warm);
attempt("before, jump", () => jumpOf(s));
attempt("before, duck", () => duckOf(s));
attempt("before, low", () => typeof s.low);
attempt("before, names", () => Object.getOwnPropertyNames(Sprite.prototype).join());

attempt("copied", () => copyMembers(Sprite, [Jumping, Ducking]).join());
attempt("after, jump", () => jumpOf(s) + " | " + s.jump() + " | " + jumpingJump(s));
attempt("after, duck", () => duckOf(s) + " | " + duckOf(s));
attempt("after, move", () => s.move().slice(0, 8));
attempt("after, names", () => Object.getOwnPropertyNames(Sprite.prototype).join());
attempt("after, a new sprite", () => jumpOf(new Sprite()) + " | " + duckOf(new Sprite()));
attempt("the same function on both classes", () => Sprite.prototype.jump === Jumping.prototype.jump);
attempt("instanceof", () => (s instanceof Jumping) + " " + (s instanceof Sprite));
attempt("the source classes still work", () => jumpingJump(new Jumping()) + " | " + new Ducking().duck());

Jumping.prototype.jump = () => "the source was patched afterwards";
attempt("the source patched, the copy stays", () => jumpOf(s) + " | " + jumpingJump(new Jumping()));

export {};
