// Don't group when both arguments are objects
call({ a: 1 }, { b: 2 });

// Don't group when both arguments are arrays
call([1, 2, 3], [4, 5, 6]);

// Don't group when both arguments are TSAsExpression
call(x as string, y as number);

// Don't group when both arguments are TSSatisfiesExpression
call(x satisfies Foo, y satisfies Bar);

// Don't group when both arguments are arrow functions
call(() => foo, () => bar);

// Don't group when both arguments are function expressions
call(function() { return foo; }, function() { return bar; });

// DO group when arguments are different types - object and array
call({ a: 1, b: 2, c: 3 }, [1, 2, 3, 4, 5, 6]);

// DO group when arguments are different types - array and object
call([1, 2, 3, 4, 5, 6], { a: 1, b: 2, c: 3 });

// DO group when first is arrow and second is object
call(() => { return foo; }, { a: 1, b: 2, c: 3 });

// DO group when first is object and second is arrow
call({ a: 1, b: 2, c: 3 }, () => { return foo; });
