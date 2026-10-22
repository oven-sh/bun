export function call(lib: object): string {
  return (lib as Record<string, () => string>)["ta" + "rget"]();
}
