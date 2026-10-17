export type Options = { name: string; loud?: boolean };
export interface Greeter<T extends Options = Options> {
  greet(options: T): string;
}
