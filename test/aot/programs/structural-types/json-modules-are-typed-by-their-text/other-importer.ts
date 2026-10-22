import data from "./data.json";
import list from "./list.json";

export function spoil(): void {
  const open: { count: number | string; list: (number | string)[]; point: { x: number | null; y: number } } = data;
  open.count = "three";
  open.list.push("four");
  open.point.x = null;
  const openList: (number | string)[] = list;
  openList[1] = "twenty";
}

export function seenHere(): unknown[] {
  return [data.count, data.list.length, data.point.x, list[1]];
}
