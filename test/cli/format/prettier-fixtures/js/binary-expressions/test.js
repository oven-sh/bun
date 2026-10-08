// It should always break the highest precedence operators first, and
// break them all at the same time.

const x = longVariable + longVariable + longVariable;
const x1 = longVariable + longVariable + longVariable + longVariable - longVariable + longVariable;
const x2 = longVariable + longVariable * longVariable + longVariable - longVariable + longVariable;
const x3 = longVariable + longVariable * longVariable * longVariable / longVariable + longVariable;

const x4 = longVariable && longVariable && longVariable && longVariable && longVariable && longVariable;
const x5 = longVariable && longVariable || longVariable && longVariable || longVariable && longVariable;
const x6 = firstItemWithAVeryLongNameThatKeepsGoing || firstItemWithAVeryLongNameThatKeepsGoing || {};
const x7 = firstItemWithAVeryLongNameThatKeepsGoing || firstItemWithAVeryLongNameThatKeepsGoing || [];
const x8 = call(firstItemWithAVeryLongNameThatKeepsGoing, firstItemWithAVeryLongNameThatKeepsGoing) || [];

const x9 = longVariable * longint && longVariable >> 0 && longVariable + longVariable;

const x10 = longVariable > longint && longVariable === 0 + longVariable * longVariable;

foo(obj.property * new Class() && obj instanceof Class && longVariable ? number + 5 : false);
