function Coded(Base: new (message?: string, options?: { cause?: unknown }) => Error) {
  return class extends Base {
    code = 7;
  };
}

const Made = Coded(RangeError);
const made = new Made("went wrong", { cause: "the cause" });
console.log("message [" + made.message + "] cause [" + made.cause + "] code " + made.code + " text [" + String(made) + "]");
console.log("own names: " + Object.getOwnPropertyNames(made).filter(n => n !== "line" && n !== "column" && n !== "sourceURL").sort().join(" ") + " keys: " + Object.keys(made).join(" "));
console.log("instance: " + (made instanceof Made) + " " + (made instanceof RangeError) + " " + (made instanceof Error) + " " + (made instanceof TypeError));
console.log("stack is a string: " + (typeof made.stack === "string") + " tag " + Object.prototype.toString.call(made));
try {
  throw new Made("thrown");
} catch (error) {
  console.log("caught: " + (error instanceof Made ? error.message + " " + error.code : "something else"));
}
console.log("json " + JSON.stringify(made) + " isError " + Error.isError(made));
