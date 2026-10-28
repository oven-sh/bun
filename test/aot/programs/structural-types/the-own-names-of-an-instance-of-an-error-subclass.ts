class Coded extends RangeError {
  code = 7;
}

const made = new Coded("zq");
console.log(Object.getOwnPropertyNames(made).sort().join(" "));
console.log(Object.getOwnPropertyNames(new RangeError("zq")).sort().join(" "));
