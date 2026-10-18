import { Season } from "./leaf";
export function make() {
  return { name: "oak", height: 3, season: Season.Fall as Season, rings: [1, 2] };
}
export function described(): { kind: string } {
  return { kind: String(make().height) };
}
