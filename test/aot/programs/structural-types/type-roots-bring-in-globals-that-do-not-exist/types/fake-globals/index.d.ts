declare const BUILD_ID: string;
declare let requestCount: number;
declare var featureFlags: { fast: boolean; level: number };
declare function track(event: string): number;
declare class Widget {
  width: number;
  constructor(width: number);
  grow(): number;
}
declare namespace Vendor {
  const version: number;
  function ping(): string;
}
declare enum Mode {
  Off,
  On,
}
interface Array<T> {
  last(): T;
}
interface String {
  shout(): string;
}
interface Number {
  readonly doubled: number;
}
