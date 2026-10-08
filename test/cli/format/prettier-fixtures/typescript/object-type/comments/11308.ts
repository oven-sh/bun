o = {/** X */
  Y: "z",
}
o = {// X
  Y: "z",
}
o = {
/** X */
  Y: "z",
}
o = {
/** X */ Y: "z",
}
o = {/** X */
  Y: "z",
  /** X */ Z: 1,
}

type T1 = {/** X */
  Y: "z",
}
type T2 = {// X
  Y: "z",
}
type T3 = {
/** X */
  Y: "z",
}
type T4 = {
/** X */ Y: "z",
}
type T5 = {/** X */
  Y: "z",
  /** X */ Z: 1,
}
