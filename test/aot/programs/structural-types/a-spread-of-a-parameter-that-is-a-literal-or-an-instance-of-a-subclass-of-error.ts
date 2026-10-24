interface Failure {
  name: string;
  message: string;
}

class Custom extends Error {
  name = "Custom";
}

function copy(f: Failure): string {
  return JSON.stringify({ ...f });
}

console.log(copy(new Custom("c")));
console.log(copy({ name: "plain", message: "m" }));

export {};
