
export type SCMRawResource = [
	number /*handle*/,
	string /*resourceUri*/,
	modes.Command /*command*/,
	string[] /*icons: light, dark*/,
	boolean /*strike through*/,
	boolean /*faded*/
];
