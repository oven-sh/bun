type T = any extends B
  /**
  * Comment
  */
    ? B | C
    : D;
type T2 = any extends B
    ? B | C
  /**
  * Comment
  */
    : D;
T = any instanceof B
  /**
  * Comment
  */
    ? B | C
    : D;
