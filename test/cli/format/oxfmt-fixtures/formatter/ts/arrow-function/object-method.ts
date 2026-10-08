let object = {
	id: '_files.pickFolderAndOpen',
	handler: (
		accessor: ServicesAccessor,
		options: { forceNewWindow: boolean }
	) => accessor.get(IFileDialogService).pickFolderAndOpen(options)
}

// https://github.com/oxc-project/oxc/issues/16201
//34567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
//     10|       20|       30|       40|       50|       60|       70|       80|       90|      100|
const xxxxxxxxxxx = async (slug: string, startItem: string, preview: boolean) => 1;
