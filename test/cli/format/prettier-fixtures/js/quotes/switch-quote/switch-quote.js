console.log([
  // 18351
  "A descriptor\\'s .kind must be \"method\" or \"field\".",

  // Will switch to single quote
  "0 backslash [  ' ] \"\"",
  "0 backslash [  \' ] \"\"",
  "1 backslash [ \\' ] \"\"",
  "1 backslash [ \\\' ] \"\"",

  // Other charectors
  "\\'\"\" [ \    ]",
  "\\'\"\" [ \\   ]",
  "\\'\"\" [ \\\  ]",
  "\\'\"\" [ \\\\ ]",
  "\\'\"\" [ \n    ]",
  "\\'\"\" [ \\n   ]",
  "\\'\"\" [ \\\n  ]",
  "\\'\"\" [ \\\\n ]",
]);
