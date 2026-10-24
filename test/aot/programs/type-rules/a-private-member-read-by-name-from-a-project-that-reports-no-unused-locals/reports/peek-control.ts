import type { Control } from "./control";

export function peekControl(control: Control): number {
  return control["hidden"];
}
