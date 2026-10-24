class Spreadable extends Array<number> {
  get [Symbol.isConcatSpreadable](): boolean {
    return true;
  }
}

console.log([0].concat(new Spreadable()).length);

export {};
