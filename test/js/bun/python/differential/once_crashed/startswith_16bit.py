# test_syntax (while its doctests are collected): str.startswith() with an empty prefix on a str of 16-bit characters
print("€".startswith(""))
print("".join(["€"])[1:].startswith(""))
print("a€".startswith("a€"))
print("€".endswith(""))
