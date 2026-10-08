// Member expressions
new   (a?.b)   ();
new   (a.b?.c)   ();
new   (a?.b.c)   ();
new   (a[b?.c])   ();
new   ((a?.b).c)   ();
new   (a[b?.()])   ();
new   ((a?.b).c)   ();
new   ((a?.()).b)   ();

// Call expressions
new   (a?.())   ();
new   (a.b.c?.())   ();
new   (a.b?.c())   ();
new   (a?.b.c())   ();
new   (a(b?.c))   ();
new   ((a?.b)())   ();
new   ((a?.())())   ();

// Not `.callee`
new Foo(a?.b);

// In optional chaining
new ((a?.b)?.c)();
