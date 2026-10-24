export interface Rectangle {
  width: number;
  height: number;
}
export function area(rectangle: Rectangle): number {
  return rectangle.width * rectangle.height;
}
