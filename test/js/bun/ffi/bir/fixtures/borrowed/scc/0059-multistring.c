int main()
{
	char * s;
	
	s = "abc" "def";
	if(s[0] != 'a') return 1;
	if(s[1] != 'b') return 2;
	if(s[2] != 'c') return 3;
	if(s[3] != 'd') return 4;
	if(s[4] != 'e') return 5;
	if(s[5] != 'f') return 6;
	if(s[6] != 0) return 7;
	
	return 0;
}
