// Promises resolved with, and awaits of, objects of classes of the program: heirs of Array, Map, Error and Object, plain classes, classes whose prototype nobody has looked at yet. None of them is a thenable until
// somebody gives it a `then`: on the object, on the class's prototype, on a prototype further up, by a method of the class, by an accessor, by Object.setPrototypeOf: then it is called, at once and every time.
const lines = [];
class Rows extends Array { count = 0; static get [Symbol.species]() { return Array; } first() { return this[0]; } }
class Table extends Map { name() { return "table"; } }
class Failure extends Error { code() { return 7; } }
class Point { constructor(x) { this.x = x; } double() { return this.x * 2; } }
class Deep extends Point { triple() { return this.x * 3; } }
class Deeper extends Deep { }
class Thenable { then(resolve) { resolve("then of the class"); } }
class HeirOfThenable extends Thenable { }
class ByAccessor { get then() { lines.push("the accessor is asked"); return undefined; } }
class Late { value() { return "late"; } }
class LateBase { }
class LateHeir extends LateBase { }
class Moved { }
const describe = x => x === null || typeof x !== "object" ? String(x) : x.constructor.name + (Array.isArray(x) ? "[" + x.join() + "]" : "");
async function returns(x) { return x; }
async function awaits(x) { return describe(await x); }
async function all(label, make) {
    const byResolve = await Promise.resolve(make());
    const byExecutor = await new Promise(resolve => resolve(make()));
    const byReturn = await returns(make());
    const byThen = await Promise.resolve(1).then(() => make());
    lines.push(label + ": " + [describe(byResolve), describe(byExecutor), describe(byReturn), describe(byThen), await awaits(make())].join(" "));
}
async function main() {
    await all("an heir of Array", () => Rows.from([1, 2]));
    await all("an heir of Map", () => new Table());
    await all("an heir of Error", () => new Failure("f"));
    await all("a class", () => new Point(1));
    await all("an heir of an heir", () => new Deeper(2));
    await all("a method called then", () => new Thenable());
    await all("inherited from the class above", () => new HeirOfThenable());
    await all("an accessor called then", () => new ByAccessor());
    await all("late, before", () => new Late());
    Late.prototype.then = function (resolve) { resolve("then given to the prototype"); };
    await all("late, behind", () => new Late());
    delete Late.prototype.then;
    await all("late, taken away", () => new Late());
    await all("the heir, before", () => new LateHeir());
    LateBase.prototype.then = function (resolve) { resolve("then given to the prototype above"); };
    await all("the heir, behind", () => new LateHeir());
    await all("moved, before", () => new Moved());
    Object.setPrototypeOf(Moved.prototype, { then(resolve) { resolve("then under the prototype"); } });
    await all("moved, behind", () => new Moved());
    const own = new Point(5);
    own.then = resolve => resolve("then of its own");
    await all("of its own", () => own);
    const rows = new Rows();
    await all("rows, before", () => rows);
    rows.then = resolve => resolve("then on the array");
    await all("rows, behind", () => rows);
    for (let i = 0; i < 100; i++) { await returns(new Rows()); await returns(new Table()); await returns(new Deeper(i)); await new Point(i); }
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
        sum += (await returns(Rows.from([i]))).first() + (await returns(new Deeper(i))).triple() + (await new Point(i)).double() + (await Promise.resolve(new Table())).size + (await new Promise(resolve => resolve(new Deep(i)))).double();
    }
    lines.push("5000 objects that cannot have a then:", sum);
    console.log(lines.join("\n"));
}
main();
