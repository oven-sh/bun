// The dead zone of the constant that holds the symbol is kept, and an object of the layout can be made before the symbol exists.
function tryRead(): string {
  try {
    return String(holder[kLate]);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function tryMake(): string {
  try {
    const made: Holder = { a: 1, [kLate]: 2 };
    return String(made[kLate]);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function tryDefine(): string {
  try {
    class Early {
      [kLate]: number = 1;
    }
    return String(new Early()[kLate]);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
interface Holder {
  a: number;
  [kLate]?: number;
}
const holder: Holder = { a: 1 };
console.log(Reflect.ownKeys(holder).map(String).join());
console.log(tryRead(), tryMake(), tryDefine());
const kLate = Symbol("late");
console.log(tryRead(), tryMake(), tryDefine());
holder[kLate] = 5;
console.log(tryRead(), Reflect.ownKeys(holder).map(String).join(), Object.getOwnPropertySymbols(holder)[0] === kLate);
