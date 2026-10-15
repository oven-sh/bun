export function pass(x) {
  return x;
}
export async function later(x) {
  await null;
  return x;
}
