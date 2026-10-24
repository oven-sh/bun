export type OnlyAType = number;
export function used() { return "used"; }
export function onlyInUnusedBody(value: number): OnlyAType { return value; }
