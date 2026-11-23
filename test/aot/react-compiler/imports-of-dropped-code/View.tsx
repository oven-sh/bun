import { deadArray } from "./dead-array";
import { deadArrow } from "./dead-arrow";
import { deadBranch } from "./dead-branch";
import { query } from "./query";
import { Shape } from "./types";
import { used } from "./used";

// The compiler drops `arrow`, `array` and the branch. Their files still run. The two that only types name do not.
export function View({ text }: Shape) {
  const arrow = () => deadArrow(text);
  const array = [deadArray];
  if (false) deadBranch(text);
  const result: ReturnType<typeof query> = used(text);
  return <p>{result as Shape["text"]}</p>;
}
