// A CommonJS file: what the compiler's output needs from other modules cannot be an import statement.
const { next } = require("./counter.js");

function View(props) {
  const list = [props.a, "kept"];
  return (
    <p>
      {list.join(" ")}
      {next()}
    </p>
  );
}

function useLabel(a) {
  "use memo";
  return [a, next()];
}

module.exports = { View, useLabel };
