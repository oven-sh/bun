//! `huffman_encode_utils.c`: builds prefix codes of limited length, and the run-length coding of their lengths.

use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec};
use crate::vp8l::format::MAX_ALLOWED_CODE_LENGTH;

/// One symbol of a `HuffmanTreeCode`, which is a slice of these.
#[derive(Clone, Copy, Default)]
pub(crate) struct Symbol {
    /// The bits to write, first bit lowest.
    pub(crate) code: u16,
    /// How many, or 0 if the symbol does not occur.
    pub(crate) length: u8,
}

/// `HuffmanTreeToken`: a symbol of the code that code lengths are written with.
#[derive(Clone, Copy, Default)]
pub(crate) struct Token {
    /// Up to 15: a code length. 16: repeat the last one. 17 and 18: zeros.
    pub(crate) code: u8,
    /// For 16 and up, how many times.
    pub(crate) extra_bits: u8,
}

#[derive(Clone, Copy, Default)]
struct HuffmanTree {
    total_count: u32,
    /// The symbol of a leaf.
    value: usize,
    /// The positions of the two children in the pool.
    children: Option<(usize, usize)>,
}

/// The working memory of `create_huffman_tree`.
pub(crate) struct Scratch {
    good_for_rle: Vec<bool>,
    tree: Vec<HuffmanTree>,
    pool: Vec<HuffmanTree>,
}

impl Scratch {
    /// For codes of up to `max_num_symbols` symbols.
    pub(crate) fn new(max_num_symbols: usize) -> Result<Self, OutOfMemory> {
        Ok(Self {
            good_for_rle: try_vec(false, max_num_symbols)?,
            tree: try_vec(HuffmanTree::default(), max_num_symbols)?,
            pool: try_vec(HuffmanTree::default(), 2 * max_num_symbols)?,
        })
    }
}

/// Changes the population counts so that the code lengths they lead to have more runs.
fn optimize_huffman_for_rle(good_for_rle: &mut [bool], counts: &mut [u32]) -> Checked {
    let Some(last) = counts.iter().rposition(|&count| count != 0) else {
        return Ok(());
    };
    let length = last + 1;
    let counts = counts.sub_mut(..length)?;
    let good_for_rle = good_for_rle.sub_mut(..length)?;

    // Runs that already are long enough for a repeat code stay as they are.
    let mut start = 0;
    for run in counts.chunk_by(|a, b| a == b) {
        let end = start + run.len();
        let is_zero = run.first() == Some(&0);
        if run.len() >= if is_zero { 5 } else { 7 } {
            good_for_rle.sub_mut(start..end)?.fill(true);
        }
        start = end;
    }

    // Stretches of similar counts become stretches of their average.
    let mut stride = 0u32;
    let mut limit = counts.at(0)?;
    let mut sum = 0u32;
    for i in 0..=length {
        let count = counts.get(i).copied();
        let stride_ends = match count {
            None => true,
            Some(count) => {
                good_for_rle.at(i)?
                    || (i != 0 && good_for_rle.at(i - 1)?)
                    || (i64::from(count) - i64::from(limit)).abs() >= 4
            }
        };
        if stride_ends {
            if stride >= 4 || (stride >= 3 && sum == 0) {
                let average = if sum == 0 {
                    0
                } else {
                    ((sum + stride / 2) / stride).max(1)
                };
                counts.sub_mut(i - stride as usize..i)?.fill(average);
            }
            stride = 0;
            sum = 0;
            limit = match counts.get(i..) {
                Some(&[c0, c1, c2, c3, ..]) => (c0 + c1 + c2 + c3 + 2) / 4,
                Some(&[c0, ..]) => c0,
                _ => 0,
            };
        }
        stride += 1;
        if let Some(count) = counts.get(i) {
            sum += count;
            if stride >= 4 {
                limit = (sum + stride / 2) / stride;
            }
        }
    }
    Ok(())
}

fn set_bit_depths(
    tree: &HuffmanTree,
    pool: &[HuffmanTree],
    code: &mut [Symbol],
    level: u8,
) -> Checked {
    match tree.children {
        Some((left, right)) => {
            // A tree this deep would take more pixels than an image has.
            let level = level.checked_add(1).ok_or(Bug)?;
            set_bit_depths(pool.at_ref(left)?, pool, code, level)?;
            set_bit_depths(pool.at_ref(right)?, pool, code, level)
        }
        None => {
            code.at_mut(tree.value)?.length = level;
            Ok(())
        }
    }
}

/// Sets the lengths of an optimal code of at most `tree_depth_limit` bits. Counts below `count_min` are taken for
/// `count_min`, which doubles until the code is short enough.
fn generate_optimal_tree(
    histogram: &[u32],
    scratch: &mut Scratch,
    tree_depth_limit: u8,
    code: &mut [Symbol],
) -> Checked {
    let tree_size_orig = histogram.iter().filter(|&&count| count != 0).count();
    if tree_size_orig == 0 {
        return Ok(());
    }
    let tree = scratch.tree.sub_mut(..tree_size_orig)?;
    let pool = &mut scratch.pool;

    let mut count_min = 1u32;
    loop {
        let leaves = histogram
            .iter()
            .enumerate()
            .filter(|(_, count)| **count != 0);
        for (node, (value, &count)) in tree.iter_mut().zip(leaves) {
            *node = HuffmanTree {
                total_count: count.max(count_min),
                value,
                children: None,
            };
        }
        // The largest count first, then the smallest symbol.
        tree.sort_unstable_by(|t1, t2| {
            t2.total_count
                .cmp(&t1.total_count)
                .then(t1.value.cmp(&t2.value))
        });

        if let [only] = tree {
            code.at_mut(only.value)?.length = 1;
        } else {
            let mut tree_size = tree_size_orig;
            let mut pool_size = 0;
            while tree_size > 1 {
                let (last, before_last) = (tree.at(tree_size - 1)?, tree.at(tree_size - 2)?);
                pool.put(pool_size, last)?;
                pool.put(pool_size + 1, before_last)?;
                pool_size += 2;
                let count = last.total_count + before_last.total_count;
                tree_size -= 2;
                let rest = tree.sub(..tree_size)?;
                let k = rest
                    .iter()
                    .position(|node| node.total_count <= count)
                    .unwrap_or(tree_size);
                tree.move_within(k, k + 1, tree_size - k)?;
                tree.put(
                    k,
                    HuffmanTree {
                        total_count: count,
                        value: 0,
                        children: Some((pool_size - 1, pool_size - 2)),
                    },
                )?;
                tree_size += 1;
            }
            set_bit_depths(tree.at_ref(0)?, pool, code, 0)?;
        }

        if code.iter().all(|symbol| symbol.length <= tree_depth_limit) {
            return Ok(());
        }
        count_min = count_min.checked_mul(2).ok_or(Bug)?;
    }
}

fn code_repeated_values(
    mut repetitions: usize,
    tokens: &mut Vec<Token>,
    value: u8,
    prev_value: u8,
) {
    let plain = Token {
        code: value,
        extra_bits: 0,
    };
    if value != prev_value {
        tokens.push(plain);
        repetitions -= 1;
    }
    while repetitions >= 1 {
        if repetitions < 3 {
            tokens.extend((0..repetitions).map(|_| plain));
            break;
        } else if repetitions < 7 {
            tokens.push(Token {
                code: 16,
                extra_bits: (repetitions - 3) as u8,
            });
            break;
        }
        tokens.push(Token {
            code: 16,
            extra_bits: 3,
        });
        repetitions -= 6;
    }
}

fn code_repeated_zeros(mut repetitions: usize, tokens: &mut Vec<Token>) {
    while repetitions >= 1 {
        if repetitions < 3 {
            tokens.extend((0..repetitions).map(|_| Token::default()));
            break;
        } else if repetitions < 11 {
            tokens.push(Token {
                code: 17,
                extra_bits: (repetitions - 3) as u8,
            });
            break;
        } else if repetitions < 139 {
            tokens.push(Token {
                code: 18,
                extra_bits: (repetitions - 11) as u8,
            });
            break;
        }
        tokens.push(Token {
            code: 18,
            extra_bits: 0x7f,
        });
        repetitions -= 138;
    }
}

/// `VP8LCreateCompressedHuffmanTree`: replaces `tokens` by the lengths of `tree`. There are no more tokens than
/// symbols, and `tokens` has room for that many.
pub(crate) fn create_compressed_huffman_tree(tree: &[Symbol], tokens: &mut Vec<Token>) {
    debug_assert!(tokens.capacity() >= tree.len());
    tokens.clear();
    // What a decoder takes the length before the first one to be.
    let mut prev_value = 8;
    for run in tree.chunk_by(|a, b| a.length == b.length) {
        let value = run.first().map_or(0, |symbol| symbol.length);
        if value == 0 {
            code_repeated_zeros(run.len(), tokens);
        } else {
            code_repeated_values(run.len(), tokens, value, prev_value);
            prev_value = value;
        }
    }
}

/// Assigns the canonical codes for the lengths.
fn convert_bit_depths_to_symbols(tree: &mut [Symbol]) -> Checked {
    let mut depth_count = [0u32; MAX_ALLOWED_CODE_LENGTH + 1];
    for symbol in tree.iter() {
        *depth_count.at_mut(symbol.length.into())? += 1;
    }
    depth_count[0] = 0;
    let mut next_code = [0u32; MAX_ALLOWED_CODE_LENGTH + 1];
    let mut code = 0;
    for (next, count) in next_code.iter_mut().skip(1).zip(depth_count) {
        code = (code + count) << 1;
        *next = code;
    }
    for symbol in tree {
        let next = next_code.at_mut(symbol.length.into())?;
        // The decoder reads a code from its most significant bit on.
        symbol.code = match symbol.length {
            0 => 0,
            length => (*next as u16).reverse_bits() >> (16 - u32::from(length)),
        };
        *next += 1;
    }
    Ok(())
}

/// `VP8LCreateHuffmanTree`: makes `huff_code`, whose lengths are all 0 so far, the code for `histogram`, which has as
/// many elements and gets smoothed on the way.
pub(crate) fn create_huffman_tree(
    histogram: &mut [u32],
    tree_depth_limit: u8,
    scratch: &mut Scratch,
    huff_code: &mut [Symbol],
) -> Checked {
    scratch.good_for_rle.fill(false);
    optimize_huffman_for_rle(&mut scratch.good_for_rle, histogram)?;
    generate_optimal_tree(histogram, scratch, tree_depth_limit, huff_code)?;
    convert_bit_depths_to_symbols(huff_code)
}
