class Config {
  static one = 1;
}

console.log(Object.keys(Config).join());
Reflect.set(Config, "one", "text");
console.log(typeof Config.one);

export {};
