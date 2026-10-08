// Issue #18973 - await with private field access needs parentheses
!(await a).#b;

// Additional test cases
(await a).#b;
(await a).b;
(await a)['b'];
(await a)[0];
