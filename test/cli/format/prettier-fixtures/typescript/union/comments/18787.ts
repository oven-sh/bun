// TODO[@fisker]: comments not attached correctly after first element
type A1 =
  | /**
   * 11
   */
  a
  | b

type A2 =
  | /**
   * 21
   */ a
  | b

type A3 =
  | // 31
  a
  |
  b;

type A4 =
  |
// 41
/**
   * 42
   */
  a
  | b
