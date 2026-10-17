declare global {
  interface SymbolConstructor {
    readonly watched: symbol;
  }
  interface Array<T> {
    lastOf?: Last<T>;
  }
}
export type Last<T> = () => T;
export interface Watched<T> {
  [Symbol.watched]: () => T;
}
