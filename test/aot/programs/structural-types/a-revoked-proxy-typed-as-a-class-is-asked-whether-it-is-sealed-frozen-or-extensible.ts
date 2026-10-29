class Point {
  x = 1;
}
const { proxy, revoke } = Proxy.revocable(new Point(), {});
revoke();
function isSealed(point: Point): string {
  try {
    return "sealed " + Object.isSealed(point);
  } catch (error) {
    return "sealed threw " + (error instanceof TypeError);
  }
}
function isFrozen(point: Point): string {
  try {
    return "frozen " + Object.isFrozen(point);
  } catch (error) {
    return "frozen threw " + (error instanceof TypeError);
  }
}
function isExtensible(point: Point): string {
  try {
    return "extensible " + Object.isExtensible(point);
  } catch (error) {
    return "extensible threw " + (error instanceof TypeError);
  }
}
console.log(isSealed(new Point()), isFrozen(new Point()), isExtensible(new Point()));
console.log(isSealed(proxy));
console.log(isFrozen(proxy));
console.log(isExtensible(proxy));
