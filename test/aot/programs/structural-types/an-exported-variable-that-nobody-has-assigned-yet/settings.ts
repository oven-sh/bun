export let level: number;
export let title: string;
export let tags: string[];
export let onChange: () => number;
export var legacy: number;

export function setAll(): void {
  level = 3;
  title = "set";
  tags = ["a"];
  onChange = () => 4;
  legacy = 5;
}

export function levelInside(): number {
  return level;
}
export function levelPlusOneInside(): number {
  return level + 1;
}
export function bump(): number {
  level++;
  return level;
}
