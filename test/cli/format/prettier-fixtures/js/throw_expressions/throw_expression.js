function save(filename = throw new TypeError("Argument required")) {}

lint(ast, {
  with: () => throw new Error("avoid using 'with' statements.")
});

function getEncoder(encoding) {
  const encoder = encoding === "utf8" ? new UTF8Encoder()
                : encoding === "utf16le" ? new UTF16Encoder(false)
                : encoding === "utf16be" ? new UTF16Encoder(true)
                : throw new Error("Unsupported encoding");
}

class Product {
  get id() { return this._id; }
  set id(value) { this._id = value || throw new Error("Invalid value"); }
}
