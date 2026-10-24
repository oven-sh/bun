class Samples extends Float64Array {}

class AsBytes extends Float64Array {
  static get [Symbol.species](): Uint8ArrayConstructor {
    return Uint8Array;
  }
}

function halves(values: Float64Array): Float64Array {
  return values.map(value => value / 2);
}

const makers: (() => Float64Array)[] = [() => new Samples([1.5]), () => new AsBytes([1.5, 2.5, 300.5])];
for (const make of makers) {
  try {
    console.log("halves", Array.from(halves(make())).join());
  } catch (error) {
    console.log("threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}
console.log("mapped", new Samples([1, 2, 3]).map(value => value * 2).length);
