// bun operators.js <function>
// Calls one function of the addon. The function prints what it finds out about operator new and operator delete.
require(process.env.ADDON)[process.argv[2]]();
