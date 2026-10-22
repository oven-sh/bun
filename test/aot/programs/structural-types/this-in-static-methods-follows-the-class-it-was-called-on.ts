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

const where = Model.where;
Model.where = function () {
  return "replaced for " + this.name + " and " + this.table;
};
round("where replaced on the base");

User.where = () => "an own arrow of the user class";
round("the user class covers it");

const view: { where?: () => string } = User;
delete view.where;
Model.where = where;
round("restored");

const create = Model.create;
Model.create = () => new Guest();
round("create replaced by an arrow that makes a guest");
Model.create = create;

Guest.table = "guests";
round("the guest class gets a table of its own");
Reflect.deleteProperty(Guest, "table");
round("and loses it");

console.log("called for another class: " + Model.where.call(User) + " | " + User.create.call(Model).describe() + " | " + Reflect.apply(Model.both, Guest, []));
const bound = Model.where.bind(Guest);
console.log("bound: " + bound());

export {};
