const { render } = require("../react-stand-in/render.js");
const hooks = require("./hooks.jsx");

exports.early = JSON.stringify(render(hooks.useList, undefined));
