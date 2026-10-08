// Issue #18972 - nested sequence expressions should preserve parentheses
const nestedSequenceAbomination =
  (1,
  2,
  (1,
  2,
  3,
  (1, 2, 3, 4),
  (1, 2, 3, 4, 5, [1, 2, 3, 4, 5, 6].filter(x => x % 2 == 0))['0']));

// Simpler test cases
const simple = (1, (2, 3), 4);
const nested = ((1, 2), (3, 4));
