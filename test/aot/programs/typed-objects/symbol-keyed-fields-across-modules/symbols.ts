export const kShared = Symbol("shared");
export const kSecond = Symbol("shared");
export interface Tagged {
  [kShared]: number;
}
