#define STR(x) #x
#define RES "This is a string!"

int
main()
{
	char str1[] = STR(This is a string!);
	char str2[] = RES;
	int i;

	for (i = 0; str1[i]; i++) {
		if (str1[i] != str2[i])
			break;
	}

	return str1[i] - str2[i];
}
