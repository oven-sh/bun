export const trail: string[] = ["trail: made"];

export function soon<T>(label: string, value: T, jobs: number): Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  for (let i = 0; i < jobs; i++) chain = chain.then(() => {});
  return chain.then(() => {
    trail.push(label);
    return value;
  });
}
