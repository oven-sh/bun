#!/bin/bash

# Test script for rm refactoring

echo "Setting up test directory structure..."
mkdir -p test_rm_dir/subdir1/subdir2
mkdir -p test_rm_dir/subdir3
touch test_rm_dir/file1.txt
touch test_rm_dir/subdir1/file2.txt
touch test_rm_dir/subdir1/subdir2/file3.txt
touch test_rm_dir/subdir3/file4.txt

echo "Test directory structure created:"
find test_rm_dir -type f -o -type d | sort

echo -e "\nRunning: bun run src/cli.zig -- rm -rv test_rm_dir"
bun run src/cli.zig -- rm -rv test_rm_dir

echo -e "\nChecking if directory was removed..."
if [ -d test_rm_dir ]; then
    echo "ERROR: test_rm_dir still exists!"
    exit 1
else
    echo "SUCCESS: test_rm_dir was removed"
fi

# Test with multiple arguments
echo -e "\nSetting up multiple files for testing..."
touch file1.txt file2.txt file3.txt
mkdir -p dir1/subdir dir2
touch dir1/file.txt dir1/subdir/file.txt
touch dir2/file.txt

echo -e "\nRunning: bun run src/cli.zig -- rm -rv file1.txt file2.txt file3.txt dir1 dir2"
bun run src/cli.zig -- rm -rv file1.txt file2.txt file3.txt dir1 dir2

echo -e "\nChecking if all files were removed..."
for f in file1.txt file2.txt file3.txt dir1 dir2; do
    if [ -e "$f" ]; then
        echo "ERROR: $f still exists!"
        exit 1
    else
        echo "SUCCESS: $f was removed"
    fi
done

echo -e "\nAll tests passed!"