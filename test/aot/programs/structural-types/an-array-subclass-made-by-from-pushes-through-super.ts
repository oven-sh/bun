class Noisy extends Array<number> {
  push(...items: number[]): number {
    return super.push(...items.map(n => n * 100));
  }
}

const noisy = Noisy.from([1, 2, 3]);
noisy.push(4);
console.log(noisy.join() + " " + noisy.constructor.name);

export {};
