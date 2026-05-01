import React from "react";
import React2 from "react";

const bacon = React;
const bacon2 = <>hello</>;

export function test() {
  console.assert(bacon === React);
  console.assert(bacon === React2);
  console.assert(typeof bacon2 !== "undefined");
  console.assert(React.isValidElement(bacon2));
  return testDone(import.meta.url);
}
