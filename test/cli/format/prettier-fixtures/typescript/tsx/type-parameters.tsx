const functionName1 = <T,>(arg) => false;
const functionName2 = <T extends any>(arg) => false;
const functionName3 = <T, S>(arg) => false;

function functionName4<T>() {
  return false;
}

functionName5<T>();

interface Interface1<T> {
  one: "one";
}

interface Interface2 {
  two: Two<T>;
}

type Type1<T> = "type1";

type Type2 = Two<T>;
