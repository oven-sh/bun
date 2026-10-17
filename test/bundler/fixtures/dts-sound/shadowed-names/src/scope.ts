export interface Scope {
  readonly closed: boolean;
}
export const Scope = { closed: false } satisfies Scope;
export function fields(scope: Scope): string[] {
  return Object.keys(scope);
}
