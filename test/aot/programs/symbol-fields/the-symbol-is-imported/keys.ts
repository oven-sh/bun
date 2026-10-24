export const kMass = Symbol("mass");
export const kLabel = Symbol("label");
export function describe(object: { [kMass]: number; [kLabel]: string }): string {
  return object[kLabel] + object[kMass];
}
