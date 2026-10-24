interface Extension {
  name: string;
  setup?: () => string;
}

function start(extension: Extension): string {
  return extension.name + " " + String(extension.setup?.());
}

const raw = { name: "odd", setup: 5 };
const named: { name: string } = raw;
const extension: Extension = named;

console.log(start({ name: "honest", setup: () => "ready" }));
try {
  console.log(start(extension));
} catch (error) {
  console.log("threw " + (error instanceof TypeError));
}
