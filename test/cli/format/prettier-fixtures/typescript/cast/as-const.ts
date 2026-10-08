let x = '123' as const;

// https://github.com/babel/babel/pull/11912
x as boolean <= y; // (x as boolean) <= y;
x as boolean ?? y; // (x as boolean) ?? y;
