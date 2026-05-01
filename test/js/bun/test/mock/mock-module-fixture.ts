import { rexported } from "./re-export-fixture";

export function fn() {
  return 42;
}

export function iCallFn() {
  return fn();
}

export const variable = 7;

export default "original";
export { rexported };

export { rexported as rexportedAs } from "./re-export-fixture";
