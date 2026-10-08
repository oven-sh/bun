// 79 width until `as` or `satisfies` keyword
const firstItem1 = ______________.items.find((item) => item.type === 'item') as const;
// 80 width until `as` or `satisfies` keyword
const firstItem_1 = ______________.items.find((item) => item.type === 'item') as const;

// 79 width until `as` or `satisfies` keyword
const firstItem2 = ______________.items.find((item) => item.type === 'item') as string | number;
// 80 width until `as` or `satisfies` keyword
const firstItem_2 = ______________.items.find((item) => item.type === 'item') as string | number;

// 79 width until `as` or `satisfies` keyword
const firstItem3 = _____________.find((item) => item.type === 'item') satisfies string | number;
// 80 width until `as` or `satisfies` keyword
const firstItem_3 = _____________.find((item) => item.type === 'item') satisfies string | number;

// 79 width until `as` or `satisfies` keyword
const firstItem4 = ______________.items.find((item) => item.type === 'item') as not_union;
// 80 width until `as` or `satisfies` keyword
const firstItem_4 = ______________.items.find((item) => item.type === 'item') as not_union;

// 79 width until `as` or `satisfies` keyword
const firstItem5 = ______________.items.find((item) => item.type === 'item') as a_union_will_break | // comments
a_union_will_break2;
// 80 width until `as` or `satisfies` keyword
const firstItem_5 = ______________.items.find((item) => item.type === 'item') as a_union_will_break | // comments
a_union_will_break2;
