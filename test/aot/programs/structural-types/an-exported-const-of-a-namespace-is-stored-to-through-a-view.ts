namespace Limits {
  export const depth = 3;
  export function twice(): number {
    return depth * 2;
  }
}

const view: { depth: number } = Limits;
console.log(Limits.depth, Limits.twice());
view.depth = 30;
console.log(Limits.depth, Limits.twice());

// The expected output is what tsc emits and what `bun build` prints: a function of the namespace reads the member of the namespace object. `bun run` puts the value of the constant in place of the name.
