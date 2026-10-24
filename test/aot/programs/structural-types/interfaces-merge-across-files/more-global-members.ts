export {};

declare global {
  interface Settings {
    name: string;
  }
  interface Array<T> {
    firstOrThrow(): T;
  }
}

export class Defaults implements Partial<Settings> {
  depth = 1;
}

export interface Defaults extends Settings {}
