export const registry = new Map<string, new () => { run(): string }>();

export function register(name: string) {
  return (value: new () => { run(): string }): void => {
    registry.set(name, value);
  };
}
