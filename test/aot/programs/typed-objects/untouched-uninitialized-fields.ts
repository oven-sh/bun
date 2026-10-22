// A field without an initializer starts as `undefined`, and so is the room for it when the object is born: nothing has to be stored, unless somebody may have stored to it first.
// IR- PropSet v\d+, v\d+ name="quiet\w+"
// IR+ PropSet v\d+, v\d+ name="touchedByInitializer"
// IR+ PropSet v\d+, v\d+ name="touchedThroughArrow"
// IR+ PropSet v\d+, v\d+ name="touchedByBase"
const made: object[] = [];
class Quiet {
  list: number[] = [];
  quietFirst: string | undefined;
  table = new Map<string, number>();
  quietSecond?: number;
  label = "l" + made.length;
  quietThird: object | undefined;
}
class Stores {
  first = this.early();
  touchedByInitializer: number | undefined;
  early(): number { this.touchedByInitializer = 5; return 1; }
}
class Arrows {
  set = () => { this.touchedThroughArrow = 7; };
  ran = (this.set(), true);
  touchedThroughArrow: number | undefined;
}
class KeepsThis { a: number[] = []; }
class QuietHeir extends KeepsThis { b: string[] = []; quietFourth: string | undefined; }
class LetsGo { constructor() { this.hook(); } hook(): void {} }
class Heir extends LetsGo { touchedByBase: number | undefined; override hook(): void { this.touchedByBase = 9; } }
for (const object of [new Quiet(), new Stores(), new Arrows(), new QuietHeir(), new Heir()]) {
  made.push(object);
  console.log(object.constructor.name, Object.keys(object).sort().join(), JSON.stringify(object), Object.entries(object).map(([key, value]) => key + ":" + typeof value).sort().join());
}
