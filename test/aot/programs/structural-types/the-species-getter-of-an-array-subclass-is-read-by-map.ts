class Results<T> extends Array<T> {
  static get [Symbol.species]() {
    return Array;
  }
}

const results = Results.from([1, 2, 3]);
console.log(results.constructor.name);
console.log(results.map(x => x * 2).constructor.name);
