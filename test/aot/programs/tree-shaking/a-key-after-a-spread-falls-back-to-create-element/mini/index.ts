function describe(props: Record<string, unknown> | null) { return JSON.stringify(props); }
export function createElement(type: string, props: Record<string, unknown> | null): string {
  return "createElement " + type + " " + describe(props);
}
