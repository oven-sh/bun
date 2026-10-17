// A property read from a sum that TypeScript calls a string and that may be a number. No number has a `length` and built-ins are locked, so on a number the read gives undefined.
// IRT= 1 lengthOfSum : undefined\|number = GetById v\d+ "length"
// IRT= 1 addedUp : undefined\|number = GetById v\d+ "length"
// IRT= 1 addedUp : number = Add
// IRT= 1 characterOfSum \|object = GetByVal
// IRT= 1 textOfSum \|object #\d+ tail = CallMethod v\d+ "toString"
function lengthOfSum(a: string, b: string) { return (a + b).length; }
function addedUp(list: string[], upTo: number) {
  let length = 0;
  for (let i = 0; i < upTo; i++) length += (list[i] + list[i + 1]).length;
  return length;
}
function textOfSum(a: string, b: string) { return (a + b).toString(); }
function characterOfSum(a: string, b: string) { return (a + b)[0]; }
function codeOfSum(a: string, b: string) {
  try {
    return (a + b).charCodeAt(0);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const missing = undefined as unknown as string;
const nothing = null as unknown as string;
for (const [a, b] of [["t", "u"], ["t", missing], [missing, "u"], [missing, missing], [nothing, nothing], [nothing, missing]])
  console.log(lengthOfSum(a, b), textOfSum(a, b), characterOfSum(a, b), codeOfSum(a, b));
console.log(addedUp(["a", "bc", "def"], 2), addedUp(["a", "bc", "def"], 3), addedUp(["a", "bc", "def"], 4), addedUp([], 1));
(globalThis as any).kept = [lengthOfSum, addedUp, textOfSum, characterOfSum, codeOfSum];
