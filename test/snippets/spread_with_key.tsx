// @ts-nocheck
import React from "react";

export function SpreadWithTheKey({ className }: Props) {
  const rest = {};
  return (
    <div className={className} key="spread-with-the-key" {...rest} onClick={() => console.log("click")}>
      Rendered component containing warning
    </div>
  );
}

export function test() {
  console.assert(React.isValidElement(<SpreadWithTheKey className="foo" />));
  return testDone(import.meta.url);
}
