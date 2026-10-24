function entry() { return "entry"; }
function original() { return "renamed"; }
export = { entry, renamed: original };
