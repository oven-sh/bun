enum Level {
  Low,
  High = 5,
}
function read(table: { readonly Low: number; readonly High: number }): number {
  return table.Low * 10 + table.High;
}
function nameOf(level: Level): string {
  return Level[level];
}
console.log(read(Level), nameOf(Level.High), Object.keys(Level).join());
Reflect.set(Level, "High", 6.5);
Reflect.set(Level, 5, "Renamed");
console.log(read(Level), nameOf(Level.High), Level.High, Object.keys(Level).join());
Reflect.deleteProperty(Level, "Low");
Reflect.deleteProperty(Level, 0);
console.log(read(Level), nameOf(Level.Low), Level.Low, Object.keys(Level).join());
Object.defineProperty(Level, "High", { get: () => 100, enumerable: true, configurable: true });
console.log(read(Level), Level.High);
