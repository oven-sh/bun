class Money {
  amount = 5;
  plus(other: this): number {
    return this.amount + other.amount;
  }
}

class Priced extends Money {
  rate = 1.5;
  unit = "eur";
  plus(other: this): number {
    return this.amount * this.rate + other.amount * other.rate;
  }
  units(other: this): string {
    return this.unit + other.unit;
  }
  width(other: this): number {
    return other.unit.length;
  }
}

const priced = new Priced();
const seenAsBase: Money = priced;
console.log(priced.plus(priced));
console.log(seenAsBase.plus(new Money()));
console.log(new Money().plus(priced));
const both: (other: Priced) => string = priced.units.bind(priced);
console.log(both(priced));

interface HasUnits {
  units(other: Money): string;
  width(other: Money): number;
}
const loose: HasUnits = priced;
console.log(loose.units(new Money()));
try {
  console.log(loose.width(new Money()));
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
