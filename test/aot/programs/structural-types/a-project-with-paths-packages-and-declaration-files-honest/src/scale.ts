import settings from "#settings";
import type { Point } from "shapes";

export function scaled(p: Point): Point {
  return { x: p.x * settings.scale + settings.offset.x, y: p.y * settings.scale + settings.offset.y };
}
