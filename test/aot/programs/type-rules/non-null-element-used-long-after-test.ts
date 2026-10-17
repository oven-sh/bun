// `const box = boxes[i]!; if (!box) return ..` with many branches, calls and loops between the test and the use of `box`.
type Box = { v: number }
const boxes: Box[] = [{ v: 1 }, { v: 2 }]
let calls = 0
function far(n: number) { calls += n; return calls > -1 }

function branches8(i: number, yes: boolean) {
  let t = 0
  const box = boxes[i]!
  if (!box) return "none"
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  return box.v + t
}
function branches40(i: number, yes: boolean) {
  let t = 0
  const box = boxes[i]!
  if (!box) return "none"
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  if (yes) t++
  return box.v + t
}
function calls80(i: number, yes: boolean) {
  let t = 0
  const box = boxes[i]!
  if (!box) return "none"
  far(0)
  far(1)
  far(2)
  far(3)
  far(4)
  far(5)
  far(6)
  far(7)
  far(8)
  far(9)
  far(10)
  far(11)
  far(12)
  far(13)
  far(14)
  far(15)
  far(16)
  far(17)
  far(18)
  far(19)
  far(20)
  far(21)
  far(22)
  far(23)
  far(24)
  far(25)
  far(26)
  far(27)
  far(28)
  far(29)
  far(30)
  far(31)
  far(32)
  far(33)
  far(34)
  far(35)
  far(36)
  far(37)
  far(38)
  far(39)
  far(40)
  far(41)
  far(42)
  far(43)
  far(44)
  far(45)
  far(46)
  far(47)
  far(48)
  far(49)
  far(50)
  far(51)
  far(52)
  far(53)
  far(54)
  far(55)
  far(56)
  far(57)
  far(58)
  far(59)
  far(60)
  far(61)
  far(62)
  far(63)
  far(64)
  far(65)
  far(66)
  far(67)
  far(68)
  far(69)
  far(70)
  far(71)
  far(72)
  far(73)
  far(74)
  far(75)
  far(76)
  far(77)
  far(78)
  far(79)
  return box.v + t
}
function loops10(i: number, yes: boolean) {
  let t = 0
  const box = boxes[i]!
  if (!box) return "none"
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  for (let k = 0; k < 2; k++) { if (yes) t++; else t-- }
  return box.v + t
}
function both20(i: number, yes: boolean) {
  let t = 0
  const box = boxes[i]!
  if (!box) return "none"
  if (far(0)) { t++ } else { t-- }
  if (far(1)) { t++ } else { t-- }
  if (far(2)) { t++ } else { t-- }
  if (far(3)) { t++ } else { t-- }
  if (far(4)) { t++ } else { t-- }
  if (far(5)) { t++ } else { t-- }
  if (far(6)) { t++ } else { t-- }
  if (far(7)) { t++ } else { t-- }
  if (far(8)) { t++ } else { t-- }
  if (far(9)) { t++ } else { t-- }
  if (far(10)) { t++ } else { t-- }
  if (far(11)) { t++ } else { t-- }
  if (far(12)) { t++ } else { t-- }
  if (far(13)) { t++ } else { t-- }
  if (far(14)) { t++ } else { t-- }
  if (far(15)) { t++ } else { t-- }
  if (far(16)) { t++ } else { t-- }
  if (far(17)) { t++ } else { t-- }
  if (far(18)) { t++ } else { t-- }
  if (far(19)) { t++ } else { t-- }
  return box.v + t
}
for (const i of [0, 5]) console.log(i, branches8(i, i === 0), branches40(i, i === 0), calls80(i, i === 0), loops10(i, i === 0), both20(i, i === 0))
