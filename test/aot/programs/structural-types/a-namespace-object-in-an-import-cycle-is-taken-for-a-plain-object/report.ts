export const lines: string[] = [];

export function note(label: string, run: () => unknown): void {
  try {
    const value = run();
    lines.push(label + ": " + typeof value + " " + String(value));
  } catch (error) {
    lines.push(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}
