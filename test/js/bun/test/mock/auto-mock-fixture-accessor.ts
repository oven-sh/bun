// Fixture for the accessor-protection path of auto-mock.test.ts. The module
// exposes a getter that records side effects; the auto-mock walker must not
// invoke it while walking exports to build the mock.

let getterHitCount = 0;

export function getterHits() {
  return getterHitCount;
}

export function plain() {
  return "plain";
}

export const obj = {
  get sneaky() {
    getterHitCount++;
    return "triggered";
  },
  get alsoSneaky() {
    getterHitCount++;
    return 99;
  },
  data: 123,
};
