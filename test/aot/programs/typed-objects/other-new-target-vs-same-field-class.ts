// Reflect.construct() with a new.target that does not extend the class, where another class of the program has the same fields.
class Point { constructor(public first: number, public second: number) {} }
class Probed { constructor(public first: number, public second: number) {} }
class Other { third = 2; fourth = 3 }
const made = Reflect.construct(Probed, [4, 5], Other);
console.log(new Point(1, 2).first, Object.getPrototypeOf(made) === Other.prototype, made instanceof Probed, made instanceof Other);
console.log(made.first, made.second, Object.keys(made).join(), new Probed(6, 7).second);
