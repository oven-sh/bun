class Config {
  static two = 2;
  static get seven(): number {
    return Config.two + 7;
  }
}

console.log(Config.seven);
Object.seal(Config);
Object.freeze(Config);
console.log(Config.seven);

export {};
