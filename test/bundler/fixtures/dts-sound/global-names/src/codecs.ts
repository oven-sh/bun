export interface Codec<T> {
  readonly decode: (input: unknown) => T;
}
export interface Field<T> extends Codec<T> {
  readonly optional: boolean;
}
export const Symbol: Codec<symbol> = { decode: input => input as symbol };
export const Text: Field<string> = { decode: input => `${input}`, optional: false };
