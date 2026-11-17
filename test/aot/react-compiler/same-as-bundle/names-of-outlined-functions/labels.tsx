type Mark = (item: string) => string;

// A function that captures nothing is declared once, beside the hook, under a name that the compiler gives it.
export function useLabel(show: (mark: Mark) => string) {
  "use memo";
  return show(item => item + "!");
}

export function useLabels(show: (...marks: Mark[]) => string) {
  "use memo";
  const shout: Mark = item => item.toUpperCase();
  return show(shout, item => item + "?");
}
