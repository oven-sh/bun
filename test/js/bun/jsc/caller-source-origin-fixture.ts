// Imported by bun-jsc.test.ts. Each helper does `return callerSourceOrigin()` from its own module.
import { callerSourceOrigin } from "bun:jsc";

export function plain() {
  return callerSourceOrigin();
}

export const arrow = () => callerSourceOrigin();

export function* generator() {
  return callerSourceOrigin();
}

export async function asyncFunction() {
  return callerSourceOrigin();
}

// After an `await` the body runs from the microtask queue, with no other JavaScript frame below it.
export async function asyncFunctionAfterAwait() {
  await 0;
  return callerSourceOrigin();
}

export const asyncArrowAfterAwait = async () => {
  await 0;
  return callerSourceOrigin();
};

export async function* asyncGenerator() {
  return callerSourceOrigin();
}
