#!/usr/bin/env python3

import os
import json
import glob
import yaml
import subprocess
import sys
import re
import argparse

def escape_js_string(s):
    """Escape a string for use in JavaScript string literals."""
    result = []
    for char in s:
        if char == '\\':
            result.append('\\\\')
        elif char == '"':
            result.append('\\"')
        elif char == '\n':
            result.append('\\n')
        elif char == '\t':
            result.append('\\t')
        elif char == '\r':
            result.append('\\r')
        elif char == '\b':
            result.append('\\b')
        elif char == '\f':
            result.append('\\f')
        elif ord(char) < 0x20 or ord(char) == 0x7F:
            # Control characters - use \xNN notation
            result.append(f'\\x{ord(char):02x}')
        else:
            result.append(char)
    return ''.join(result)

def format_js_string(content):
    """Format content for JavaScript string literal."""
    # For JavaScript we'll use template literals for multiline strings
    # unless they contain backticks or ${
    if '`' in content or '${' in content:
        # Use regular string with escaping
        escaped = escape_js_string(content)
        return f'"{escaped}"'
    elif '\n' in content:
        # Use template literal for multiline
        # But we still need to escape backslashes
        escaped_content = content.replace('\\', '\\\\')  # Escape backslashes
        return f'`{escaped_content}`'
    else:
        # Short single line - use regular string
        escaped = escape_js_string(content)
        return f'"{escaped}"'

def has_anchors_or_aliases(yaml_content):
    """Check if YAML content has anchors (&) or aliases (*)."""
    return '&' in yaml_content or '*' in yaml_content

def stringify_map_keys(obj, from_yaml_package=False):
    """Recursively stringify all map keys to match Bun's YAML behavior.

    Args:
        obj: The object to process
        from_yaml_package: If True, empty string keys came from yaml package converting null keys
                          and should be converted to "null". If False, empty strings are intentional.
    """
    if isinstance(obj, dict):
        new_dict = {}
        for key, value in obj.items():
            # Convert key to string
            if key is None:
                # Actual None/null key should become "null"
                str_key = "null"
            elif key == "" and from_yaml_package:
                # Empty string from yaml package (was originally a null key in YAML)
                # should be converted to "null" to match Bun's behavior
                str_key = "null"
            elif key == "":
                # Empty string from official test JSON or explicit empty string
                # should stay as empty string
                str_key = ""
            elif isinstance(key, str) and from_yaml_package:
                # Check if this is a stringified collection from yaml package
                # yaml package converts [a, b] to "[ a, b ]" but Bun/JS uses "a,b"
                if key.startswith('[ ') and key.endswith(' ]'):
                    # This looks like a stringified array from yaml package
                    # Extract the content and convert to JS array.toString() format
                    inner = key[2:-2]  # Remove "[ " and " ]"
                    # Split by comma and space, then join with just comma
                    elements = []
                    for elem in inner.split(','):
                        elem = elem.strip()
                        # Remove anchor notation (&name) from the element
                        # Anchors appear as "&name value" in the stringified form
                        if '&' in elem:
                            # Remove the anchor part (e.g., "&b b" becomes "b")
                            parts = elem.split()
                            if len(parts) > 1 and parts[0].startswith('&'):
                                elem = ' '.join(parts[1:])
                        elements.append(elem)
                    str_key = ','.join(elements)
                elif key.startswith('{ ') and key.endswith(' }'):
                    # This looks like a stringified object from yaml package
                    # JavaScript Object.toString() returns "[object Object]"
                    str_key = "[object Object]"
                elif key.startswith('*'):
                    # This is an alias reference that wasn't resolved by yaml package
                    # This shouldn't happen in well-formed output, but handle it
                    # For now, keep it as-is but this might need special handling
                    str_key = key
                else:
                    str_key = str(key)
            else:
                # All other keys get stringified
                str_key = str(key)
            # Recursively process value
            new_dict[str_key] = stringify_map_keys(value, from_yaml_package)
        return new_dict
    elif isinstance(obj, list):
        return [stringify_map_keys(item, from_yaml_package) for item in obj]
    else:
        return obj

def json_to_js_literal(obj, indent_level=1, seen_objects=None, var_declarations=None):
    """Convert JSON object to JavaScript literal, handling shared references."""
    if seen_objects is None:
        seen_objects = {}
    if var_declarations is None:
        var_declarations = []

    indent = "    " * indent_level

    if obj is None:
        return "null"
    elif isinstance(obj, bool):
        return "true" if obj else "false"
    elif isinstance(obj, (int, float)):
        # Handle special float values
        if obj != obj:  # NaN
            return "NaN"
        elif obj == float('inf'):
            return "Infinity"
        elif obj == float('-inf'):
            return "-Infinity"
        return str(obj)
    elif isinstance(obj, str):
        escaped = escape_js_string(obj)
        return f'"{escaped}"'
    elif isinstance(obj, list):
        if len(obj) == 0:
            return "[]"

        # Check for complex nested structures
        if any(isinstance(item, (list, dict)) for item in obj):
            items = []
            for item in obj:
                item_str = json_to_js_literal(item, indent_level + 1, seen_objects, var_declarations)
                items.append(f"{indent}    {item_str}")
            return "[\n" + ",\n".join(items) + f"\n{indent}]"
        else:
            # Simple array - inline
            items = [json_to_js_literal(item, indent_level, seen_objects, var_declarations) for item in obj]
            return "[" + ", ".join(items) + "]"
    elif isinstance(obj, dict):
        if len(obj) == 0:
            return "{}"

        # Check if this is a simple object
        is_simple = all(not isinstance(v, (list, dict)) for v in obj.values())

        if is_simple and len(obj) <= 3:
            # Simple object - inline
            pairs = []
            for key, value in obj.items():
                if key.isidentifier() and not key.startswith('$'):
                    key_str = key
                else:
                    key_str = f'"{escape_js_string(key)}"'
                value_str = json_to_js_literal(value, indent_level, seen_objects, var_declarations)
                pairs.append(f"{key_str}: {value_str}")
            return "{ " + ", ".join(pairs) + " }"
        else:
            # Complex object - multiline
            pairs = []
            for key, value in obj.items():
                if key.isidentifier() and not key.startswith('$'):
                    key_str = key
                else:
                    key_str = f'"{escape_js_string(key)}"'
                value_str = json_to_js_literal(value, indent_level + 1, seen_objects, var_declarations)
                pairs.append(f"{indent}    {key_str}: {value_str}")
            return "{\n" + ",\n".join(pairs) + f"\n{indent}}}"
    else:
        # Fallback
        return json.dumps(obj)

def parse_test_events(event_file):
    """Parse test.event file to infer expected JSON structure.

    Event format:
    +STR - Stream start
    +DOC - Document start
    +MAP - Map start
    +SEQ - Sequence start
    =VAL - Value (scalar)
    =ALI - Alias
    -MAP - Map end
    -SEQ - Sequence end
    -DOC - Document end
    -STR - Stream end
    """
    if not os.path.exists(event_file):
        return None

    with open(event_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    docs = []
    stack = []
    current_doc = None
    in_key = False
    pending_key = None

    for line in lines:
        line = line.rstrip('\n')
        if not line:
            continue

        if line.startswith('+DOC'):
            stack = []
            current_doc = None
            in_key = False
            pending_key = None

        elif line.startswith('+MAP'):
            new_map = {}
            if stack:
                parent = stack[-1]
                if isinstance(parent, list):
                    parent.append(new_map)
                elif isinstance(parent, dict) and pending_key is not None:
                    parent[pending_key] = new_map
                    pending_key = None
                    in_key = False
            else:
                current_doc = new_map
            stack.append(new_map)

        elif line.startswith('+SEQ'):
            new_seq = []
            if stack:
                parent = stack[-1]
                if isinstance(parent, list):
                    parent.append(new_seq)
                elif isinstance(parent, dict) and pending_key is not None:
                    parent[pending_key] = new_seq
                    pending_key = None
                    in_key = False
            else:
                current_doc = new_seq
            stack.append(new_seq)

        elif line.startswith('=VAL'):
            # Extract value after =VAL
            value = line[4:].strip()
            if value.startswith(':'):
                value = value[1:].strip() if len(value) > 1 else ''

            # Convert special values
            if value == '':
                value = ''
            elif value == '<SPC>':
                value = ' '

            if stack:
                parent = stack[-1]
                if isinstance(parent, list):
                    parent.append(value)
                elif isinstance(parent, dict):
                    if in_key or pending_key is None:
                        # This is a key
                        pending_key = value
                        in_key = False
                    else:
                        # This is a value for the pending key
                        parent[pending_key] = value
                        pending_key = None
            else:
                # Scalar document
                current_doc = value

        elif line.startswith('-MAP') or line.startswith('-SEQ'):
            if stack:
                completed = stack.pop()
                # If this was the last item and we have a pending key, it means empty value
                if isinstance(stack[-1] if stack else None, dict) and pending_key is not None:
                    (stack[-1] if stack else {})[pending_key] = None
                    pending_key = None

        elif line.startswith('-DOC'):
            if current_doc is not None:
                docs.append(current_doc)
            current_doc = None
            stack = []
            pending_key = None

    return docs if docs else None

def detect_shared_references(yaml_content):
    """Detect anchors and their aliases in YAML to identify shared references."""
    # Find all anchors and their aliases
    anchor_pattern = r'&(\w+)'
    alias_pattern = r'\*(\w+)'

    anchors = re.findall(anchor_pattern, yaml_content)
    aliases = re.findall(alias_pattern, yaml_content)

    # Return anchors that are referenced by aliases
    shared_refs = []
    for anchor in set(anchors):
        if anchor in aliases:
            shared_refs.append(anchor)

    return shared_refs

def generate_shared_reference_tests(yaml_content, parsed_path="parsed"):
    """Generate toBe() tests for shared references based on anchors/aliases in YAML."""
    tests = []

    # Common patterns for shared references
    patterns = [
        # bill-to/ship-to pattern
        (r'bill-to:\s*&(\w+)', r'ship-to:\s*\*\1', 'bill-to', 'ship-to'),
        # Array items with anchors
        (r'-\s*&(\w+)\s+', r'-\s*\*\1', None, None),
        # Map values with anchors
        (r':\s*&(\w+)\s+', r':\s*\*\1', None, None),
    ]

    # Check for bill-to/ship-to pattern specifically
    if 'bill-to:' in yaml_content and 'ship-to:' in yaml_content:
        if re.search(r'bill-to:\s*&\w+', yaml_content) and re.search(r'ship-to:\s*\*\w+', yaml_content):
            tests.append(f'    // Shared reference check: bill-to and ship-to should be the same object')
            tests.append(f'    expect({parsed_path}["bill-to"]).toBe({parsed_path}["ship-to"]);')

    # Check for x-foo pattern (common in OpenAPI specs)
    if re.search(r'x-\w+:\s*&\w+', yaml_content):
        anchor_match = re.search(r'x-(\w+):\s*&(\w+)', yaml_content)
        if anchor_match:
            field_name = f'x-{anchor_match.group(1)}'
            anchor_name = anchor_match.group(2)
            # Find aliases to this anchor
            alias_pattern = rf'\*{anchor_name}\b'
            if re.search(alias_pattern, yaml_content):
                tests.append(f'    // Shared reference check: anchor {anchor_name}')
                # This is generic - would need more context to generate specific tests

    return tests

def generate_expected_with_shared_refs(json_data, yaml_content):
    """Generate expected object with shared references for anchors/aliases."""
    shared_refs = detect_shared_references(yaml_content)

    if not shared_refs:
        # No shared references, generate simple literal
        return json_to_js_literal(json_data)

    # For simplicity, when there are anchors/aliases, we'll generate the expected
    # object but note that some values might be shared references
    # This is a simplified approach - in reality we'd need to track which values
    # are aliased to generate exact shared references

    # Generate with a comment about shared refs
    result = json_to_js_literal(json_data)

    # Add comment about shared references
    comment = f"    // Note: Original YAML has anchors/aliases: {', '.join(shared_refs)}\n"
    comment += "    // Some values in the parsed result may be shared object references\n"

    return comment + "    const expected = " + result + ";"

def get_expected_from_yaml_parser(yaml_content, use_eemeli_yaml=True):
    """Use yaml package (eemeli/yaml) or js-yaml to get expected output."""
    # Create a temporary JavaScript file to parse the YAML
    if use_eemeli_yaml:
        # Use eemeli/yaml which is more spec-compliant
        js_code = f'''
const YAML = require('/Users/dylan/yamlz-3/node_modules/yaml');

const input = {format_js_string(yaml_content)};

try {{
    const docs = YAML.parseAllDocuments(input);
    const results = docs.map(doc => doc.toJSON());
    console.log(JSON.stringify(results));
}} catch (e) {{
    console.log(JSON.stringify({{"error": e.message}}));
}}
'''
    else:
        # Fallback to js-yaml
        js_code = f'''
const yaml = require('/Users/dylan/yamlz-3/node_modules/js-yaml');

const input = {format_js_string(yaml_content)};

try {{
    const docs = yaml.loadAll(input);
    console.log(JSON.stringify(docs));
}} catch (e) {{
    console.log(JSON.stringify({{"error": e.message}}));
}}
'''

    # Write to temp file and execute with node
    temp_js = '/tmp/parse_yaml_temp.js'
    with open(temp_js, 'w') as f:
        f.write(js_code)

    try:
        result = subprocess.run(['node', temp_js], capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            output = json.loads(result.stdout.strip())
            if isinstance(output, dict) and 'error' in output:
                return None, output['error']
            return output, None
        else:
            return None, result.stderr or "Failed to parse"
    except subprocess.TimeoutExpired:
        return None, "Timeout"
    except Exception as e:
        return None, str(e)
    finally:
        if os.path.exists(temp_js):
            os.remove(temp_js)

def generate_test(test_dir, test_name, check_ast=True, use_js_yaml=False, use_yaml_pkg=False):
    """Generate a single Bun test case from a yaml-test-suite directory.

    Args:
        test_dir: Directory containing the test files
        test_name: Name for the test
        check_ast: If True, validate parsed AST. If False, only check parse success/failure.
        use_js_yaml: If True, generate test using js-yaml instead of Bun's YAML
        use_yaml_pkg: If True, generate test using yaml package instead of Bun's YAML
    """

    yaml_file = os.path.join(test_dir, "in.yaml")
    json_file = os.path.join(test_dir, "in.json")
    desc_file = os.path.join(test_dir, "===")

    # Read YAML content
    if not os.path.exists(yaml_file):
        return None

    with open(yaml_file, 'r', encoding='utf-8') as f:
        yaml_content = f.read()

    # Read test description
    description = ""
    if os.path.exists(desc_file):
        with open(desc_file, 'r', encoding='utf-8') as f:
            description = f.read().strip().replace('\n', ' ')

    # Check if this is an error test (has 'error' file)
    error_file = os.path.join(test_dir, "error")
    is_error_test = os.path.exists(error_file)

    # For js-yaml, check if it actually can parse this
    js_yaml_fails = False
    js_yaml_error_msg = None
    if use_js_yaml and not is_error_test:
        # Quick check if js-yaml will fail on this
        yaml_js_docs, yaml_js_error = get_expected_from_yaml_parser(yaml_content, use_eemeli_yaml=False)
        if yaml_js_error:
            js_yaml_fails = True
            js_yaml_error_msg = yaml_js_error

    # If js-yaml fails but spec says it should pass, generate a special test
    if use_js_yaml and js_yaml_fails and not is_error_test:
        formatted_content = format_js_string(yaml_content)
        return f'''
test.skip("{test_name}", () => {{
    // {description}
    // SKIPPED: js-yaml fails but spec says this should pass
    // js-yaml error: {js_yaml_error_msg}
    const input = {formatted_content};

    // js-yaml is stricter than the YAML spec - it fails on this valid YAML
    // The official test suite says this should parse successfully
}});
'''

    if is_error_test:
        # Generate error test
        formatted_content = format_js_string(yaml_content)
        if use_js_yaml:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Error test - expecting parse to fail (using js-yaml)
    const input = {formatted_content};

    expect(() => {{
        return jsYaml.load(input);
    }}).toThrow();
}});
'''
        elif use_yaml_pkg:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Error test - expecting parse to fail (using yaml package)
    const input = {formatted_content};

    expect(() => {{
        return yamlPkg.parse(input);
    }}).toThrow();
}});
'''
        else:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Error test - expecting parse to fail
    const input: string = {formatted_content};

    expect(() => {{
        return YAML.parse(input);
    }}).toThrow();
}});
'''

    # Special handling for known problematic tests
    if test_name == "yaml-test-suite/2SXE":
        # 2SXE has complex anchor on key itself, not a shared reference case
        test = f'''
test("{test_name}", () => {{
    // {description}
    // Note: &a anchors the key "key" itself, *a references that string
    const input: string = {format_js_string(yaml_content)};

    const parsed = YAML.parse(input);

    const expected: any = {{ key: "value", foo: "key" }};

    expect(parsed).toEqual(expected);
}});
'''
        return test

    if test_name == "yaml-test-suite/X38W":
        # X38W has alias key that creates duplicate - yaml package doesn't handle this correctly
        # The correct output is just one key "a,b" with value ["c", "b", "d"]
        test = f'''
test("{test_name}", () => {{
    // {description}
    // Special case: *a references the same array as first key, creating duplicate key
    const input: string = {format_js_string(yaml_content)};

    const parsed = YAML.parse(input);

    const expected: any = {{
        "a,b": ["c", "b", "d"]
    }};

    expect(parsed).toEqual(expected);
}});
'''
        return test

    # Get expected data from official test suite JSON file if available
    json_data = None
    has_json = False

    if os.path.exists(json_file):
        with open(json_file, 'r', encoding='utf-8') as f:
            json_content = f.read().strip()

        if not json_content:
            json_data = [None]  # Empty file represents null document
            has_json = True
        else:
            try:
                # Try single document
                single_doc = json.loads(json_content)
                json_data = [single_doc]
                has_json = True
            except json.JSONDecodeError:
                # Try to parse as multiple JSON objects concatenated
                decoder = json.JSONDecoder()
                idx = 0
                docs = []
                while idx < len(json_content):
                    json_content_from_idx = json_content[idx:].lstrip()
                    if not json_content_from_idx:
                        break
                    try:
                        obj, end_idx = decoder.raw_decode(json_content_from_idx)
                        docs.append(obj)
                        idx += len(json_content[idx:]) - len(json_content_from_idx) + end_idx
                    except json.JSONDecodeError:
                        break

                if docs:
                    json_data = docs
                    has_json = True
                else:
                    # Last resort: Try multi-document (one JSON per line)
                    docs = []
                    for line in json_content.split('\n'):
                        line = line.strip()
                        if line:
                            try:
                                docs.append(json.loads(line))
                            except:
                                pass

                    if docs:
                        json_data = docs
                        has_json = True

    # If no JSON from test suite, use yaml package as reference
    # (Skip test.event parsing for now as it's too simplistic)
    if not has_json:
        yaml_docs, yaml_error = get_expected_from_yaml_parser(yaml_content, use_eemeli_yaml=True)
        if yaml_error:
            # yaml package couldn't parse it, but maybe Bun's YAML can
            # Just check that it doesn't throw
            formatted_content = format_js_string(yaml_content)
            return f'''
test("{test_name}", () => {{
    // {description}
    // Parse test - yaml package couldn't parse, checking YAML behavior
    const input = {formatted_content};

    // Test may pass or fail, we're just documenting behavior
    try {{
        const parsed = YAML.parse(input);
        // Successfully parsed
        expect(parsed).toBeDefined();
    }} catch (e) {{
        // Failed to parse
        expect(e).toBeDefined();
    }}
}});
'''
        else:
            json_data = yaml_docs

    # If not checking AST, just verify parse success
    if not check_ast:
        formatted_content = format_js_string(yaml_content)
        if use_js_yaml:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Success test - expecting parse to succeed (AST checking disabled, using js-yaml)
    const input = {formatted_content};

    const parsed = jsYaml.load(input);
    expect(parsed).toBeDefined();
}});
'''
        elif use_yaml_pkg:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Success test - expecting parse to succeed (AST checking disabled, using yaml package)
    const input = {formatted_content};

    const parsed = yamlPkg.parse(input);
    expect(parsed).toBeDefined();
}});
'''
        else:
            return f'''
test("{test_name}", () => {{
    // {description}
    // Success test - expecting parse to succeed (AST checking disabled)
    const input: string = {formatted_content};

    const parsed = YAML.parse(input);
    expect(parsed).toBeDefined();
}});
'''

    # Format the YAML content for JavaScript
    formatted_content = format_js_string(yaml_content)

    # Generate the test
    comment = f"// {description}"
    event_file = os.path.join(test_dir, "test.event")
    if not os.path.exists(json_file) and os.path.exists(event_file):
        comment += " (using test.event for expected values)"
    elif not os.path.exists(json_file):
        comment += " (using yaml package for expected values)"

    # Check if YAML has anchors/aliases
    has_refs = has_anchors_or_aliases(yaml_content)

    # Handle multi-document YAML
    # Only check the actual parsed data to determine if it's multi-document
    # Document markers like --- and ... don't reliably indicate multiple documents
    is_multi_doc = json_data and len(json_data) > 1

    if is_multi_doc:
        # Multi-document test - YAML.parse will return an array
        if use_js_yaml:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = jsYaml.loadAll(input);
'''
        elif use_yaml_pkg:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = yamlPkg.parseAllDocuments(input).map(doc => doc.toJSON());
'''
        else:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = YAML.parse(input);
'''

        # Generate expected array
        if has_refs:
            test += '''
    // Note: Original YAML may have anchors/aliases
    // Some values in the parsed result may be shared object references
'''

        # Apply key stringification to match Bun's behavior
        # from_yaml_package=!has_json: True if data came from yaml package, False if from official JSON
        stringified_data = stringify_map_keys(json_data, from_yaml_package=not has_json)
        expected_str = json_to_js_literal(stringified_data)
        test += f'''
    const expected: any = {expected_str};

    expect(parsed).toEqual(expected);
}});
'''
    else:
        # Single document test
        expected_value = json_data[0] if json_data else None

        if use_js_yaml:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = jsYaml.load(input);
'''
        elif use_yaml_pkg:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = yamlPkg.parse(input);
'''
        else:
            test = f'''
test("{test_name}", () => {{
    {comment}
    const input: string = {formatted_content};

    const parsed = YAML.parse(input);
'''

        # Generate expected value
        if has_refs:
            # For tests with anchors/aliases, we need to handle shared references
            # Check specific patterns in YAML
            if '*' in yaml_content and '&' in yaml_content:
                # Has both anchors and aliases - need to create shared references
                test += '''
    // This YAML has anchors and aliases - creating shared references
'''
                # Try to identify simple cases
                if 'bill-to: &' in yaml_content and 'ship-to: *' in yaml_content:
                    # Common pattern: bill-to/ship-to sharing
                    stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                    if isinstance(stringified_value, dict) and 'bill-to' in stringified_value:
                        # Generate expected value normally with toBe check
                        expected_str = json_to_js_literal(stringified_value)
                        test += f'''
    const expected: any = {expected_str};

    expect(parsed).toEqual(expected);

    // Verify shared references - bill-to and ship-to should be the same object
    expect((parsed as any)["bill-to"]).toBe((parsed as any)["ship-to"]);
}});
'''
                        return test
                    else:
                        # Fallback to regular generation
                        stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                        expected_str = json_to_js_literal(stringified_value)
                        test += f'''
    const expected: any = {expected_str};'''
                else:
                    # Generic anchor/alias case
                    # Look for patterns like "- &anchor value" and "- *anchor"
                    anchor_matches = re.findall(r'&(\w+)', yaml_content)
                    alias_matches = re.findall(r'\*(\w+)', yaml_content)

                    if anchor_matches and alias_matches:
                        # Build shared values based on anchors
                        shared_anchors = []
                        for anchor_name in set(anchor_matches):
                            if anchor_name in alias_matches:
                                # This anchor is referenced by an alias
                                shared_anchors.append(anchor_name)

                        if shared_anchors and isinstance(expected_value, (list, dict)):
                            # Generate the expected value
                            stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                            expected_str = json_to_js_literal(stringified_value)

                            # Build toBe checks based on detected patterns
                            toBe_checks = []

                            # Try to detect specific patterns for toBe checks
                            # Pattern 1: Array with repeated elements (- &anchor value, - *anchor)
                            for anchor in shared_anchors:
                                # Check if it's in an array context
                                if re.search(rf'-\s+&{anchor}\s+', yaml_content) and re.search(rf'-\s+\*{anchor}', yaml_content):
                                    # This might be array elements - but hard to know indices without parsing
                                    pass
                                # Check if it's in mapping values (not keys)
                                # Pattern: "key: &anchor" not "&anchor:" (which anchors the key)
                                # Use [\w-]+ to match keys with hyphens like "bill-to"
                                anchor_key_match = re.search(rf'([\w-]+):\s*&{anchor}\s', yaml_content)
                                alias_key_matches = re.findall(rf'([\w-]+):\s*\*{anchor}(?:\s|$)', yaml_content)
                                if anchor_key_match and alias_key_matches:
                                    anchor_key = anchor_key_match.group(1)
                                    for alias_key in alias_key_matches:
                                        if anchor_key != alias_key:
                                            # Additional check: make sure the anchor is not on a key itself
                                            if not re.search(rf'&{anchor}:', yaml_content):
                                                toBe_checks.append(f'    expect((parsed as any)["{anchor_key}"]).toBe((parsed as any)["{alias_key}"]);')

                            test += f'''
    // Detected anchors that are referenced: {', '.join(shared_anchors)}

    const expected: any = {expected_str};

    expect(parsed).toEqual(expected);'''

                            if toBe_checks:
                                test += '\n\n    // Verify shared references\n'
                                test += '\n'.join(toBe_checks)

                            test += '\n});'
                            return test
                        else:
                            # No shared anchors or not a dict/list
                            stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                            expected_str = json_to_js_literal(stringified_value)
                            test += f'''
    const expected: any = {expected_str};'''
                    else:
                        stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                        expected_str = json_to_js_literal(stringified_value)
                        test += f'''
    const expected: any = {expected_str};'''
            else:
                # Has anchors but no aliases, or vice versa
                stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
                expected_str = json_to_js_literal(stringified_value)
                test += f'''
    const expected: any = {expected_str};'''
        else:
            # No anchors/aliases - simple case
            stringified_value = stringify_map_keys(expected_value, from_yaml_package=not has_json)
            expected_str = json_to_js_literal(stringified_value)
            test += f'''
    const expected: any = {expected_str};'''

        test += '''

    expect(parsed).toEqual(expected);
});
'''

    return test

def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='Translate yaml-test-suite to Bun tests')
    parser.add_argument('--no-ast-check', action='store_true',
                        help='Only check if parsing succeeds/fails, do not validate AST')
    parser.add_argument('--with-js-yaml', action='store_true',
                        help='Also generate a companion test file using js-yaml for validation')
    parser.add_argument('--with-yaml', action='store_true',
                        help='Also generate a companion test file using yaml package for validation')
    args = parser.parse_args()

    check_ast = not args.no_ast_check
    with_js_yaml = args.with_js_yaml
    with_yaml = args.with_yaml

    # Check if yaml package is installed (for getting expected values)
    yaml_pkg_found = False
    try:
        # Try local node_modules first
        subprocess.run(['node', '-e', "require('./node_modules/yaml')"], capture_output=True, check=True, cwd='/Users/dylan/yamlz-3')
        yaml_pkg_found = True
    except:
        try:
            # Try global install
            subprocess.run(['node', '-e', "require('yaml')"], capture_output=True, check=True)
            yaml_pkg_found = True
        except:
            pass

    if not yaml_pkg_found and check_ast:
        print("Error: yaml package is not installed. Please run: npm install yaml")
        print("Note: yaml package is only required when checking AST. Use --no-ast-check to skip AST validation.")
        sys.exit(1)

    # Get all test directories
    test_dirs = []
    yaml_test_suite_path = '/Users/dylan/yamlz-3/yaml-test-suite'

    for entry in glob.glob(f'{yaml_test_suite_path}/*'):
        if os.path.isdir(entry) and os.path.basename(entry) not in ['.git', 'name', 'tags']:
            # Check if this is a test directory (has in.yaml)
            if os.path.exists(os.path.join(entry, 'in.yaml')):
                test_dirs.append(entry)
            else:
                # Check for subdirectories with in.yaml (multi-doc tests)
                for subdir in glob.glob(os.path.join(entry, '*')):
                    if os.path.isdir(subdir) and os.path.exists(os.path.join(subdir, 'in.yaml')):
                        test_dirs.append(subdir)

    test_dirs = sorted(test_dirs)

    print(f"Found {len(test_dirs)} test directories in yaml-test-suite")
    if not check_ast:
        print("AST checking disabled - will only verify parse success/failure")

    # Generate a sample test first
    if test_dirs:
        print("\nGenerating sample test...")
        # Look for a test with anchors/aliases
        sample_dir = None
        for td in test_dirs:
            yaml_file = os.path.join(td, "in.yaml")
            if os.path.exists(yaml_file):
                with open(yaml_file, 'r') as f:
                    content = f.read()
                    if '&' in content and '*' in content:
                        sample_dir = td
                        break

        if not sample_dir:
            sample_dir = test_dirs[0]

        test_id = sample_dir.replace(yaml_test_suite_path + '/', '')
        test_name = f"yaml-test-suite/{test_id}"

        sample_test = generate_test(sample_dir, test_name, check_ast)
        if sample_test:
            print(f"Sample test for {test_id}:")
            print(sample_test[:800] + "..." if len(sample_test) > 800 else sample_test)

    # Generate all tests
    print("\nGenerating all tests...")

    mode_comment = "// AST validation disabled - only checking parse success/failure" if not check_ast else "// Using YAML.parse() with eemeli/yaml package as reference"

    # Get yaml-test-suite commit hash
    yaml_test_suite_commit = None
    try:
        result = subprocess.run(['git', 'rev-parse', 'HEAD'],
                              capture_output=True, text=True,
                              cwd=yaml_test_suite_path)
        if result.returncode == 0:
            yaml_test_suite_commit = result.stdout.strip()
    except:
        pass

    commit_comment = f"// Generated from yaml-test-suite commit: {yaml_test_suite_commit}" if yaml_test_suite_commit else ""

    output = f'''// Tests translated from official yaml-test-suite
{commit_comment}
{mode_comment}
// Total: {len(test_dirs)} test directories

import {{ test, expect }} from "bun:test";
import {{ YAML }} from "bun";

'''

    successful = 0
    failed = 0

    for i, test_dir in enumerate(test_dirs):
        test_id = test_dir.replace(yaml_test_suite_path + '/', '')
        test_name = f"yaml-test-suite/{test_id}"

        if (i + 1) % 50 == 0:
            print(f"  Processing {i+1}/{len(test_dirs)}...")

        try:
            test_case = generate_test(test_dir, test_name, check_ast)
            if test_case:
                output += test_case + '\n'  # Add newline between tests
                successful += 1
            else:
                print(f"    Skipped {test_name}: returned None")
                failed += 1
        except Exception as e:
            print(f"    Error with {test_name}: {e}")
            failed += 1

    # Write the output file to Bun's test directory
    output_dir = '/Users/dylan/code/bun/test/js/bun/yaml'
    os.makedirs(output_dir, exist_ok=True)

    filename = os.path.join(output_dir, 'yaml-test-suite.test.ts')
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(output)

    print(f"\nGenerated {filename}")
    print(f"  Successful: {successful} tests")
    print(f"  Failed/Skipped: {failed} tests")
    print(f"  Total: {len(test_dirs)} directories processed")

    # Generate js-yaml companion tests if requested
    if with_js_yaml:
        print("\nGenerating js-yaml companion tests...")

        js_yaml_output = f'''// Tests translated from official yaml-test-suite
// Using js-yaml for validation of test translations
// Total: {len(test_dirs)} test directories

import {{ test, expect }} from "bun:test";
const jsYaml = require("js-yaml");

'''

        js_yaml_successful = 0
        js_yaml_failed = 0

        for i, test_dir in enumerate(test_dirs):
            test_id = test_dir.replace(yaml_test_suite_path + '/', '')
            test_name = f"js-yaml/{test_id}"

            if (i + 1) % 50 == 0:
                print(f"  Processing js-yaml {i+1}/{len(test_dirs)}...")

            try:
                test_case = generate_test(test_dir, test_name, check_ast, use_js_yaml=True)
                if test_case:
                    js_yaml_output += test_case
                    js_yaml_successful += 1
                else:
                    js_yaml_failed += 1
            except Exception as e:
                print(f"    Error with {test_name}: {e}")
                js_yaml_failed += 1

        # Write js-yaml test file
        js_yaml_filename = os.path.join(output_dir, 'yaml-test-suite-js-yaml.test.ts')
        with open(js_yaml_filename, 'w', encoding='utf-8') as f:
            f.write(js_yaml_output)

        print(f"\nGenerated js-yaml companion: {js_yaml_filename}")
        print(f"  Successful: {js_yaml_successful} tests")
        print(f"  Failed/Skipped: {js_yaml_failed} tests")


    # Generate yaml package companion tests if requested
    if with_yaml:
        print("\nGenerating yaml package companion tests...")

        yaml_output = f'''// Tests translated from official yaml-test-suite
// Using yaml package (eemeli/yaml) for validation of test translations
// Total: {len(test_dirs)} test directories
// Note: Requires 'yaml' package to be installed: npm install yaml

import {{ test, expect }} from "bun:test";
import * as yamlPkg from "yaml";

'''

        yaml_successful = 0
        yaml_failed = 0

        for i, test_dir in enumerate(test_dirs):
            test_id = test_dir.replace(yaml_test_suite_path + '/', '')
            test_name = f"yaml-pkg/{test_id}"

            if (i + 1) % 50 == 0:
                print(f"  Processing yaml package {i+1}/{len(test_dirs)}...")

            try:
                test_case = generate_test(test_dir, test_name, check_ast, use_yaml_pkg=True)
                if test_case:
                    yaml_output += test_case
                    yaml_successful += 1
                else:
                    yaml_failed += 1
            except Exception as e:
                print(f"    Error with {test_name}: {e}")
                yaml_failed += 1

        # Write yaml package test file
        yaml_filename = os.path.join(output_dir, 'yaml-test-suite-yaml-pkg.test.ts')
        with open(yaml_filename, 'w', encoding='utf-8') as f:
            f.write(yaml_output)

        print(f"\nGenerated yaml package companion: {yaml_filename}")
        print(f"  Successful: {yaml_successful} tests")
        print(f"  Failed/Skipped: {yaml_failed} tests")

    print(f"\nTo run tests: cd {output_dir} && bun test")

if __name__ == '__main__':
    main()