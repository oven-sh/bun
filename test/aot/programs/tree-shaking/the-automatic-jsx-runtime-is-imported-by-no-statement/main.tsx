// No import statement names the runtime: the pragma does. Its jsx, jsxs, jsxDEV and Fragment are function declarations that call helpers of their file.
/** @jsxImportSource ./mini */
function Item(props: { label: string }) {
  return <li>{props.label}</li>;
}

console.log(<ul><Item label="one" /><Item label="two" /></ul>);
console.log(<><Item label="three" /></>);
