// Member expressions
new   (a?.b)!   ();
new   (a?.b!)   ();
new   (a!?.b)   ();
new   (a.b?.c)!   ();
new   (a.b?.c!)   ();
new   (a.b!?.c)   ();
new   (a!.b?.c)   ();
new   (a?.b.c)!   ();
new   (a?.b.c!)   ();
new   (a?.b!.c)   ();
new   (a!?.b.c)   ();
new   (a[b?.c])!   ();
new   (a[b?.c]!)   ();
new   (a[b?.c!])   ();
new   (a[b!?.c])   ();
new   ((a?.b).c)!   ();
new   ((a?.b).c!)   ();
new   ((a?.b!).c)   ();
new   ((a!?.b).c)   ();
new   (a[b?.()])!   ();
new   (a[b?.()]!)   ();
new   (a[b?.()!])   ();
new   (a[b!?.()])   ();
new   (a![b?.()])   ();
new   ((a?.b).c)!   ();
new   ((a?.b).c!)   ();
new   ((a?.b)!.c)   ();
new   ((a?.b!).c)   ();
new   ((a!?.b).c)   ();
new   ((a?.()).b)!   ();
new   ((a?.()).b!)   ();
new   ((a?.())!.b)   ();
new   ((a?.()!).b)   ();
new   ((a!?.()).b)   ();

// Call expressions
new   (a?.())!   ();
new   (a?.()!)   ();
new   (a!?.())   ();
new   (a.b.c?.())!   ();
new   (a.b.c?.()!)   ();
new   (a.b.c!?.())   ();
new   (a.b?.c())!   ();
new   (a.b?.c()!)   ();
new   (a.b!?.c())   ();
new   (a?.b.c())!   ();
new   (a?.b.c()!)   ();
new   (a?.b!.c())   ();
new   (a(b?.c))!   ();
new   (a(b?.c)!)   ();
new   (a(b?.c!))   ();
new   ((a?.b)())!   ();
new   ((a?.b)()!)   ();
new   ((a?.b)!())   ();
new   ((a?.b!)())   ();
new   ((a?.())())!   ();
new   ((a?.())()!)   ();
new   ((a?.())!())   ();
new   ((a?.()!)())   ();
new   ((a!?.())())   ();

// Not `.callee`
new Foo(a?.b!);

// In optional chaining
new ((a?.b!)?.c)();
new ((a?.b)!?.c)();
