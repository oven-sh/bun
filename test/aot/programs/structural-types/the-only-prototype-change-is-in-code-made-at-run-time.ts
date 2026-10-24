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

const relink = new Function("target", "proto", "target.__proto__ = proto;");

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts(new Cat()).length;
console.log("2000 honest: " + warm);

const cat = new Cat();
console.log("before: " + facts(cat));
relink(cat, Robot.prototype);
console.log("after: " + facts(cat));
console.log("another cat: " + facts(new Cat()));

export {};
