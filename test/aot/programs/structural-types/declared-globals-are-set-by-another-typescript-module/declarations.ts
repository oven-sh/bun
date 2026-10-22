export {};

declare global {
  var sharedLimit: number;
  var sharedTitle: string;
  var sharedPoint: { x: number; y: number };
  var sharedNever: number;
  function sharedTwice(n: number): number;
}
