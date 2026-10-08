const vscode = require("vscode");
const {getDir, getActiveFile, uint8arrayToString} = require("./utils");

let outChannel;
let _commands;
