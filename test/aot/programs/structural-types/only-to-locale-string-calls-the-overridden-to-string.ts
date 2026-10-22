class Coin {
  toString(): string {
    return "a coin";
  }
}

class Priced {
  toLocaleString(): string {
    return "priced here";
  }
}

console.log(new Coin().toLocaleString() + " | " + [new Priced(), new Priced()].toLocaleString());

export {};
