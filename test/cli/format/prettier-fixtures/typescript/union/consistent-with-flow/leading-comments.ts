type T1 =
  /* comment */ A
  | /* A comment long enough to make the union type break into multiple lines */ B;
type T12 =
  /* comment */ | A
  | /* A comment long enough to make the union type break into multiple lines */ B;
type T13 =
  | /* comment */ A
  | /* A comment long enough to make the union type break into multiple lines */ B;

type T2 = /* comment */ 'A'
  | /* A comment long enough to make the union type break into multiple lines */ B;

type T3 = // comment
  'A'
  | /* A comment long enough to make the union type break into multiple lines */ B;

type T4 =
  // comment
  'A'
  | /* A comment long enough to make the union type break into multiple lines */ B;

type T5 =
  /**
  comment
  */ 'A'
  | /* A comment long enough to make the union type break into multiple lines */ B;

type T6 =
  /**
  comment
  */
  'A'
  | /* A comment long enough to make the union type break into multiple lines */ B;
