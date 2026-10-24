class Cat {
  name = "cat";
  speak(): string {
    return "meow";
  }
}

class Robot {
  name = "robot";
  speak(): string {
    return "beep";
  }
}

function facts(c: Cat): string {
  return c.speak() + " " + (c instanceof Cat) + " " + (c instanceof Robot) + " " + c.constructor.name;
}

function act(target: Cat, action: (target: Cat, proto: object) => unknown): void {
  action(target, Robot.prototype);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts(new Cat()).length;
console.log("2000 honest: " + warm);

const cat = new Cat();
console.log("before: " + facts(cat));
act(cat, Object.setPrototypeOf);
console.log("after: " + facts(cat));
console.log("another cat: " + facts(new Cat()));

export {};
