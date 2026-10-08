// Issue #18941 - single-member unions should not have unnecessary parentheses
type Items = ( | number)[];
type Items2 = ( & number)[];

// Multi-member unions should keep parentheses
type Items3 = (string | number)[];

// Simple case without array
type Simple = | number;
