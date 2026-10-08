// Issue #18970 - comment between parameter name and type annotation
function f(x /* a */ : number) {}

// Additional test cases
function g(y /* comment */ : string, z /* another */ : boolean) {}

// With different comment styles
function h(a /* inline */ : number) {}

// Multiple parameters with comments
const arrow = (x /* c1 */ : number, y /* c2 */ : string) => {};

// Optional parameters with comments
function optional(x? /* comment */ : number) {}
function optionalMultiple(a? /* c1 */ : string, b? /* c2 */ : number) {}
