const lost = value => new CustomEvent("lost", { detail: value }).detail;
exports.itself = module;
exports.seen = () => {
  const own = lost(module);
  return [own.parent.id, own.children.length, lost(require).main.id, lost(process).mainModule === own.parent].join(" ");
};
