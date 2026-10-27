/// Test hooks (private copy only): the table as `bits | value << 16`, `None` if the code is refused, `Err` for Bug.
pub fn hook_build(code_lengths: &[u8]) -> Result<Option<Vec<u32>>, ()> {
    let mut tables = vec![HuffmanCode::default(); 3];
    let mut sorted = [0u16; MAX_CODE_LENGTHS_SIZE];
    let valid = is_valid_huffman_code(code_lengths).map_err(|_| ())?;
    match append_huffman_table(&mut tables, code_lengths, &mut sorted) {
        Ok(start) => {
            if !valid || start != 3 { return Err(()); }
            Ok(Some(tables.iter().skip(3).map(|c| c.0).collect()))
        }
        Err(Error::BitstreamError) if !valid => Ok(None),
        Err(_) => Err(()),
    }
}
pub fn hook_build_lengths(code_lengths: &[u8; CODE_LENGTH_CODES]) -> Result<Option<Vec<u32>>, ()> {
    Ok(build_lengths_table(code_lengths).map_err(|_| ())?.map(|t| t.iter().map(|c| c.0).collect()))
}
