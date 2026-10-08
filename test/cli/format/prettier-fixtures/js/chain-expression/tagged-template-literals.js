// Member expressions
(a?.b)   ``;
(a.b?.c)   ``;
(a?.b.c)   ``;
(a[b?.c])   ``;
((a?.b).c)   ``;
(a[b?.()])   ``;
((a?.b).c)   ``;
((a?.()).b)   ``;

// Call expressions
(a?.())   ``;
(a.b.c?.())   ``;
(a.b?.c())   ``;
(a?.b.c())   ``;
(a(b?.c))   ``;
((a?.b)())   ``;
((a?.())())   ``;


// In optional chaining
((a?.b)?.c)  ``;
