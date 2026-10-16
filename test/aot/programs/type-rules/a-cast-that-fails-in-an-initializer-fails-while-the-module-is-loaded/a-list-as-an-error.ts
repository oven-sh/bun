interface Failure extends Error { code: number }
export const made = ([1, 2]) as unknown as Failure;
