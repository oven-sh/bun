// On an import cycle with ./caller, whose body runs first and calls what this file declares.
import { early } from "./caller";

export function useList() {
  "use memo";
  return ["kept"];
}

// Returns out of the middle of what is memoized.
export function useChoice(props: { isFirst: boolean; first: number; second: number }) {
  "use memo";
  const chosen: number[] = [];
  if (props.isFirst) {
    chosen.push(props.first);
    return chosen;
  } else {
    return [props.second];
  }
}

export const toldEarly = early;
