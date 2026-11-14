const words = ["pear", "apple", "fig"];
console.log(words.sort((a, b) => a.localeCompare(b)).join(), "a-b-c".search(/b/), /x/gi.flags);
