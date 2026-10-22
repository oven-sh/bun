// Each line calls its own function behind a condition that a compiler may fold. All of them are true, so all the functions run.
const log = [];
function a1() { log.push("a1"); } function a2() { log.push("a2"); } function a3() { log.push("a3"); } function a4() { log.push("a4"); }
function a5() { log.push("a5"); } function a6() { log.push("a6"); } function a7() { log.push("a7"); } function a8() { log.push("a8"); }
function b1() { log.push("b1"); } function b2() { log.push("b2"); } function b3() { log.push("b3"); } function b4() { log.push("b4"); }
function b5() { log.push("b5"); } function b6() { log.push("b6"); } function b7() { log.push("b7"); } function b8() { log.push("b8"); }
function c1() { log.push("c1"); } function c2() { log.push("c2"); } function c3() { log.push("c3"); } function c4() { log.push("c4"); }
function c5() { log.push("c5"); } function c6() { log.push("c6"); } function c7() { log.push("c7"); } function c8() { log.push("c8"); }

null ?? a1();
undefined ?? a2();
void 0 ?? a3();
"" || a4();
0 || a5();
NaN || a6();
-0 || a7();
0n || a8();
"0" && b1();
[] && b2();
({}) && b3();
!0 && b4();
!"" && b5();
-1 && b6();
1n && b7();
(() => {}) && b8();
if (typeof undefined === "undefined") c1();
if (typeof null === "object") c2();
if (null == undefined) c3();
if ("b" > "a") c4();
if (1 + 1 === 2) c5();
if ("a" + "b" === "ab") c6();
if (!(0.1 + 0.2 === 0.3)) c7();
if (/x/) c8();
console.log(log.join(" "));
