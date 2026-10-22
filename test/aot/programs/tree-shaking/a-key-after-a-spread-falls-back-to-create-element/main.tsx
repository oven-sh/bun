// With the automatic runtime `<a {...props} key="k" />` cannot go through jsx(): it calls createElement, imported from the package itself and named by no statement.
/** @jsxImportSource ./mini */
const props = { id: "i" };
console.log(<a {...props} key="k" />);
console.log(<a key="k" {...props} />);
