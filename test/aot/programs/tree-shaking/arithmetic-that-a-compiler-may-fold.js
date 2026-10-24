// Each line calls its own function behind a comparison of constants whose answer is easy to get wrong. All of them hold.
const log = [];
function f01() { log.push(1); } function f02() { log.push(2); } function f03() { log.push(3); } function f04() { log.push(4); } function f05() { log.push(5); }
function f06() { log.push(6); } function f07() { log.push(7); } function f08() { log.push(8); } function f09() { log.push(9); } function f10() { log.push(10); }
function f11() { log.push(11); } function f12() { log.push(12); } function f13() { log.push(13); } function f14() { log.push(14); } function f15() { log.push(15); }
function f16() { log.push(16); } function f17() { log.push(17); } function f18() { log.push(18); } function f19() { log.push(19); } function f20() { log.push(20); }
function f21() { log.push(21); } function f22() { log.push(22); } function f23() { log.push(23); } function f24() { log.push(24); } function f25() { log.push(25); }
function f26() { log.push(26); } function f27() { log.push(27); } function f28() { log.push(28); } function f29() { log.push(29); } function f30() { log.push(30); }

0 === -0 && f01();
NaN !== NaN && f02();
"1" == 1 && f03();
null == 0 || f04();
null >= 0 && f05();
undefined >= 0 || f06();
"" == 0 && f07();
"\t" == 0 && f08();
1 < 2 < 3 && f09();
3 > 2 > 1 || f10();
2 ** 53 === 2 ** 53 + 1 && f11();
0.1 * 3 !== 0.3 && f12();
1n == 1 && f13();
1 << 32 === 1 && f14();
5 % -3 === 2 && f15();
-5 % 3 === -2 && f16();
"5" * "2" === 10 && f17();
"5" + 2 === "52" && f18();
1 + null === 1 && f19();
typeof typeof 1 === "string" && f20();
~~"7" === 7 && f21();
(1, 0) || f22();
"b" > "a" && "B" < "a" && f23();
"10" < "9" && f24();
"10" < 9 || f25();
-1 >>> 0 === 4294967295 && f26();
1 / -0 === -Infinity && f27();
"abc".length === 3 && f28();
"abc"[1] === "b" && f29();
!!"false" && f30();
console.log(log.join(" "));
