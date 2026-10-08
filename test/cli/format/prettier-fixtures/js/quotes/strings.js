// Prevent strings from being parsed as directives
// See https://github.com/prettier/prettier/pull/1560#issue-227225960
0;

// Every string will be changed to double quotes, unless we end up with fewer
// escaped quotes by using single quotes. (Vice versa if the "singleQuote"
// option is true).
//
// Note that even if a string already has the correct enclosing quotes, it is
// still processed in order to remove unnecessarily escaped quotes within it,
// for consistency.

// Simple strings.
"abc"
'abc'

// Escape.
'\0'

// Emoji.
'🐶'

// Empty string.
""
''

// Single double quote.
"\""
'"'

// Single single quote.
"'"
'\''

// Unnecessary escapes.
"\'"
'\"'
"\a"
'\a'
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
'escaped \u2030 \‰ (should not stay escaped)'

// Meaningful escapes
"octal escapes \0 \1 \2 \3 \4 \5 \6 \7"
'octal escapes \0 \1 \2 \3 \4 \5 \6 \7'
"meaningfully escaped alphabetical characters \n \r \v \t \b \f \u2713 \x61"
'meaningfully escaped alphabetical characters \n \r \v \t \b \f \u2713 \x61'
'escaped newline \
'
'escaped carriage return \
'
'escaped \u2028 \ '
'escaped \u2029 \ '

// One of each.
"\"'"
'"\''

// One of each with unnecessary escapes.
"\"\'"
'\"\''

// More double quotes than single quotes.
"\"'\""
'"\'"'

// More single quotes than double quotes.
"\"''"
'"\'\''

// Two of each.
"\"\"''"
'""\'\''

// Single backslash.
'\\'
"\\"

// Backslases.
"\"\\\"\\\\\" '\'\\'\\\'\\\\'"
'\'\\\'\\\\\' "\"\\"\\\"\\\\"'

// Somewhat more real-word example.
"He's sayin': \"How's it goin'?\" Don't ask me why."
'He\'s sayin\': "How\'s it goin\'?" Don\'t ask me why.'

// Somewhat more real-word example 2.
"var backslash = \"\\\", doubleQuote = '\"';"
'var backslash = "\\", doubleQuote = \'"\';'
