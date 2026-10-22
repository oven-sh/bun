function original() { return "original"; }
function chosenAsDefault() { return "chosen as default"; }
function quoted() { return "quoted"; }
const twice = () => "twice";
function notExported() { return "not exported"; }

export { original as renamed, chosenAsDefault as default, quoted as "a name with spaces", twice as once, twice as again };
