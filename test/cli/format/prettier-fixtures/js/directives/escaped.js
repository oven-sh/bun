// Unnecessary escapes. (adapted from tests/quotes/strings.js)
// Note that in directives, unnecessary escapes should be preserved.
// See https://github.com/prettier/prettier/issues/1555
'\'';
'\"';
"\'";
"\"";
'\\';
'\a';
"hol\a"
'hol\a'
"hol\\a (the a is not escaped)"
'hol\\a (the a is not escaped)'
"multiple \a unnecessary \a escapes"
'multiple \a unnecessary \a escapes'
"unnecessarily escaped character preceded by escaped backslash \\\a"
'unnecessarily escaped character preceded by escaped backslash \\\a'
"unescaped character preceded by two escaped backslashes       \\\\a"
'unescaped character preceded by two escaped backslashes       \\\\a'
"\a\a" // consecutive unnecessarily escaped characters
'\a\a' // consecutive unnecessarily escaped characters
'escaped \u2030 \‰ (should still stay escaped)'

// Meaningful escapes
// Commented out to avoid `SyntaxError: Octal literals are not allowed in strict mode.`
// "octal escapes \0 \1 \2 \3 \4 \5 \6 \7"
// 'octal escapes \0 \1 \2 \3 \4 \5 \6 \7'
"meaningfully escaped alphabetical characters \n \r \v \t \b \f \u2713 \x61"
'meaningfully escaped alphabetical characters \n \r \v \t \b \f \u2713 \x61'
'escaped newline \
'
'escaped carriage return \
'
'escaped \u2028 \ '
'escaped \u2029 \ '
