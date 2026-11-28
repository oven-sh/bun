const re = new RegExp("(?<=[^0c]{1,3}?3\\s??)\\s(?:[[0-9][xyz]]{2,}?d){1}", "iv");
print("constructed");
print(re.exec(" 88d"));
