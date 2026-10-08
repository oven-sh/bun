// Member expressions
(a?.b)!   .foo;
(a?.b!)   .foo;
(a!?.b)   .foo;
(a.b?.c)!   .foo;
(a.b?.c!)   .foo;
(a.b!?.c)   .foo;
(a!.b?.c)   .foo;
(a?.b.c)!   .foo;
(a?.b.c!)   .foo;
(a?.b!.c)   .foo;
(a!?.b.c)   .foo;
(a[b?.c])!   .foo;
(a[b?.c]!)   .foo;
(a[b?.c!])   .foo;
(a[b!?.c])   .foo;
((a?.b).c)!   .foo;
((a?.b).c!)   .foo;
((a?.b!).c)   .foo;
((a!?.b).c)   .foo;
(a[b?.()])!   .foo;
(a[b?.()]!)   .foo;
(a[b?.()!])   .foo;
(a[b!?.()])   .foo;
(a![b?.()])   .foo;
((a?.b).c)!   .foo;
((a?.b).c!)   .foo;
((a?.b)!.c)   .foo;
((a?.b!).c)   .foo;
((a!?.b).c)   .foo;
((a?.()).b)!   .foo;
((a?.()).b!)   .foo;
((a?.())!.b)   .foo;
((a?.()!).b)   .foo;
((a!?.()).b)   .foo;

// Call expressions
(a?.())!   .foo;
(a?.()!)   .foo;
(a!?.())   .foo;
(a.b.c?.())!   .foo;
(a.b.c?.()!)   .foo;
(a.b.c!?.())   .foo;
(a.b?.c())!   .foo;
(a.b?.c()!)   .foo;
(a.b!?.c())   .foo;
(a?.b.c())!   .foo;
(a?.b.c()!)   .foo;
(a?.b!.c())   .foo;
(a(b?.c))!   .foo;
(a(b?.c)!)   .foo;
(a(b?.c!))   .foo;
((a?.b)())!   .foo;
((a?.b)()!)   .foo;
((a?.b)!())   .foo;
((a?.b!)())   .foo;
((a?.())())!   .foo;
((a?.())()!)   .foo;
((a?.())!())   .foo;
((a?.()!)())   .foo;
((a!?.())())   .foo;


// Not `.object`
_[a?.b!];

// Computed
(a?.b!)   [foo];

// In optional chaining
(a?.b!)?.c;
(a?.b)!?.c;
(a?.b!).c?.d;
(a?.b)!.c?.d;
