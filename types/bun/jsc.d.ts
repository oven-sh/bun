declare module "bun:jsc" {
  export function describe(value: any): string;
  export function describeArray(args: any[]): string;
  export function gcAndSweep(): void;
  export function fullGC(): void;
  export function edenGC(): void;
  export function heapSize(): number;
  export function heapStats();
  export function memoryUsage(): {
    current: number;
    peak: number;
    currentCommit: number;
    peakCommit: number;
    pageFaults: number;
  };
  export function getRandomSeed(): number;
  export function setRandomSeed(value: number): void;
  export function isRope(input: string): bool;
  export function callerSourceOrigin(): string;
  export function noFTL(func: Function): Function;
  export function noOSRExitFuzzing(func: Function): Function;
  export function optimizeNextInvocation(func: Function): Function;
  export function numberOfDFGCompiles(func: Function): number;
  export function releaseWeakRefs(): void;
  export function totalCompileTime(func: Function): number;
  export function reoptimizationRetryCount(func: Function): number;
  export function drainMicrotasks(): void;

  /**
   * Start a remote debugging socket server on the given port.
   *
   * This exposes JavaScriptCore's built-in debugging server.
   */
  export function startRemoteDebugger(host?: string, port?: number): void;
}
