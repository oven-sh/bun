export function useIsString(value: unknown = "none", label: string = "x"): value is string {
  "use memo";
  return typeof value === "string" && label.length > 0;
}

export const useIsNumber = (value: unknown = 0): value is number => {
  "use memo";
  return typeof value === "number";
};

export function useAssertedString(value: unknown = "none"): asserts value is string {
  "use memo";
  if (typeof value !== "string") throw new TypeError("not a string");
}

export function useAssertedGiven(value: string | undefined = "none"): asserts value {
  "use memo";
  if (!value) throw new TypeError("not given");
}

// The one hook with something to remember.
export function useLine(parts: (string | number)[]): string[] {
  "use memo";
  return [parts.join(" ")];
}

// A hook that calls a hook is compiled without the directive.
export function useIsLine(value: unknown = "none"): value is string {
  const lines = useLine([String(value)]);
  return typeof value === "string" && lines.length === 1;
}
