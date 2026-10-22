class Model {
  static table = "models";
  id = 1;
  static create(): Model {
    return new this();
  }
  static where(): string {
    return "from " + this.table + " by " + this.name;
  }
  static both(): string {
    return this.where() + " / " + this.create().describe();
  }
  describe(): string {
    return "a " + this.constructor.name + " with " + Object.keys(this).join();
  }
}

class User extends Model {
  static table = "users";
  email = "e";
}

class Guest extends User {}

function whereOf(c: typeof Model): string {
  return c.where();
}

function createWith(c: typeof Model): string {
  return c.create().describe();
}

const classes: (typeof Model)[] = [Model, User, Guest];

function round(label: string): void {
  for (const c of classes) console.log(label + ", " + c.name + ": " + whereOf(c) + " | " + createWith(c) + " | " + c.both());
  console.log(label + ", named: " + Model.where() + " | " + User.where() + " | " + Guest.where() + " | " + Guest.create().describe());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += whereOf(classes[i % 3]).length + createWith(classes[i % 3]).length + User.where().length;
console.log("2000 honest: " + warm);
round("before");

export {};
