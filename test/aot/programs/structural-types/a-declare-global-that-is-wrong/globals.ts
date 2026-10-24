export {};

declare global {
  var buildNumber: number;
  var featureFlags: { fast: boolean; level: number };
  var registry: string[];
  function double(n: number): number;
  function missing(n: number): number;
  const fixedLimit: 10;
  const neverSet: number;
  class Gadget {
    size: number;
    constructor(size: number);
    grow(): number;
    shrink(): number;
  }
  interface Math {
    half(n: number): number;
    third(n: number): number;
  }
}
