//! `backward_references_cost_enc.c`: improves on an LZ77 by finding, with the symbol costs it led to, the cheapest way
//! to reach each pixel.

use super::backward_references::{
    BackwardRefs, HashChain, MAX_LENGTH, PixOrCopy, distance_to_plane_code,
};
use super::histogram::{Histogram, histogram_num_codes};
use super::lossless::{LOG_2_PRECISION_BITS, div_round, fast_log2, prefix_encode};
use crate::EncodeError;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec};
use crate::vp8l::color_cache::ColorCache;
use crate::vp8l::format::{NUM_DISTANCE_CODES, NUM_LENGTH_CODES, NUM_LITERAL_CODES};

/// What each symbol costs.
struct CostModel {
    alpha: [u32; NUM_LITERAL_CODES],
    red: [u32; NUM_LITERAL_CODES],
    blue: [u32; NUM_LITERAL_CODES],
    distance: [u32; NUM_DISTANCE_CODES],
    literal: Vec<u32>,
}

fn convert_population_count_table_to_bit_estimates(population_counts: &[u32], output: &mut [u32]) {
    let sum: u32 = population_counts.iter().sum();
    let nonzeros = population_counts.iter().filter(|&&count| count > 0).count();
    if nonzeros <= 1 {
        output.fill(0);
    } else {
        let logsum = fast_log2(sum);
        for (output, &count) in output.iter_mut().zip(population_counts) {
            *output = logsum - fast_log2(count);
        }
    }
}

impl CostModel {
    /// `CostModelBuild`
    fn new(xsize: usize, cache_bits: u32, refs: &BackwardRefs) -> Result<Self, EncodeError> {
        let mut histo = Histogram::new(cache_bits)?;
        histo.store_refs(refs, |distance| distance_to_plane_code(xsize, distance))?;
        let mut m = Self {
            alpha: [0; NUM_LITERAL_CODES],
            red: [0; NUM_LITERAL_CODES],
            blue: [0; NUM_LITERAL_CODES],
            distance: [0; NUM_DISTANCE_CODES],
            literal: try_vec(0, histogram_num_codes(cache_bits))?,
        };
        convert_population_count_table_to_bit_estimates(&histo.literal, &mut m.literal);
        convert_population_count_table_to_bit_estimates(&histo.red, &mut m.red);
        convert_population_count_table_to_bit_estimates(&histo.blue, &mut m.blue);
        convert_population_count_table_to_bit_estimates(&histo.alpha, &mut m.alpha);
        convert_population_count_table_to_bit_estimates(&histo.distance, &mut m.distance);
        Ok(m)
    }

    #[inline]
    fn get_literal_cost(&self, v: u32) -> Checked<i64> {
        let [b, g, r, a] = v.to_le_bytes().map(usize::from);
        Ok(i64::from(self.alpha.at(a)?)
            + i64::from(self.red.at(r)?)
            + i64::from(self.literal.at(g)?)
            + i64::from(self.blue.at(b)?))
    }

    #[inline]
    fn get_cache_cost(&self, idx: u32) -> Checked<i64> {
        let literal_idx = NUM_LITERAL_CODES + NUM_LENGTH_CODES + idx as usize;
        Ok(self.literal.at(literal_idx)?.into())
    }

    fn get_length_cost(&self, length: u32) -> Checked<i64> {
        let prefix = prefix_encode(length);
        Ok(i64::from(self.literal.at(NUM_LITERAL_CODES + prefix.code)?)
            + (i64::from(prefix.extra_bits) << LOG_2_PRECISION_BITS))
    }

    fn get_distance_cost(&self, distance: u32) -> Checked<i64> {
        let prefix = prefix_encode(distance);
        Ok(i64::from(self.distance.at(prefix.code)?)
            + (i64::from(prefix.extra_bits) << LOG_2_PRECISION_BITS))
    }
}

// -----------------------------------------------------------------------------
// CostManager and interval handling

/// The most intervals to keep. What does not fit goes into the costs at once.
const COST_CACHE_INTERVAL_SIZE_MAX: usize = 500;

/// A copy from `index` reaches the pixels from `start` to `end` (exclusive) at `cost`, and nothing known reaches them
/// for less. The intervals form a list sorted by `start` and do not overlap.
#[derive(Clone, Copy, Default)]
struct CostInterval {
    cost: i64,
    start: usize,
    end: usize,
    index: usize,
    previous: Option<usize>,
    next: Option<usize>,
}

/// The lengths from `start` to `end` (exclusive) all cost `cost`.
#[derive(Clone, Copy)]
struct CostCacheInterval {
    cost: i64,
    start: usize,
    end: usize,
}

/// A copy from a pixel makes each of the up to `MAX_LENGTH` pixels after it reachable, at the cost of the distance
/// plus that of the length. Lengths fall into a few ranges of equal cost, so that instead of one comparison for each
/// of those pixels there is one interval for each range.
struct CostManager<'a> {
    head: Option<usize>,
    cache_intervals: Vec<CostCacheInterval>,
    /// What a copy of `k + 1` pixels is taken to cost: `get_length_cost(k)`, which is one length off.
    cost_cache: Vec<i64>,
    /// The lowest cost known of reaching each pixel.
    costs: Vec<i64>,
    /// The length of the step that reaches each pixel at that cost.
    dist_array: &'a mut [u16],
    /// `previous` and `next` are positions in here.
    intervals: Vec<CostInterval>,
    /// The elements of `intervals` that are not in the list.
    free_intervals: Vec<usize>,
}

impl<'a> CostManager<'a> {
    fn new(dist_array: &'a mut [u16], cost_model: &CostModel) -> Result<Self, EncodeError> {
        let pix_count = dist_array.len();
        let cost_cache_size = pix_count.min(MAX_LENGTH);

        let mut cost_cache = try_vec(0, cost_cache_size)?;
        for (cost, length) in cost_cache.iter_mut().zip(0..) {
            *cost = cost_model.get_length_cost(length)?;
        }
        let mut cache_intervals = Vec::new();
        cache_intervals
            .try_reserve(cost_cache.chunk_by(|a, b| a == b).count())
            .map_err(|_| OutOfMemory)?;
        let mut start = 0;
        for run in cost_cache.chunk_by(|a, b| a == b) {
            let end = start + run.len();
            cache_intervals.push(CostCacheInterval {
                cost: run.first().copied().ok_or(Bug)?,
                start,
                end,
            });
            start = end;
        }

        let mut free_intervals = Vec::new();
        free_intervals
            .try_reserve_exact(COST_CACHE_INTERVAL_SIZE_MAX)
            .map_err(|_| OutOfMemory)?;
        free_intervals.extend(0..COST_CACHE_INTERVAL_SIZE_MAX);
        Ok(Self {
            head: None,
            cache_intervals,
            cost_cache,
            costs: try_vec(i64::MAX, pix_count)?,
            dist_array,
            intervals: try_vec(CostInterval::default(), COST_CACHE_INTERVAL_SIZE_MAX)?,
            free_intervals,
        })
    }

    /// Pixel `i` can be reached from `position` at `cost`.
    #[inline]
    fn update_cost(&mut self, i: usize, position: usize, cost: i64) -> Checked {
        let best = self.costs.at_mut(i)?;
        if *best > cost {
            *best = cost;
            self.dist_array.put(i, (i - position + 1) as u16)?;
        }
        Ok(())
    }

    fn update_cost_per_interval(
        &mut self,
        start: usize,
        end: usize,
        position: usize,
        cost: i64,
    ) -> Checked {
        for i in start..end {
            self.update_cost(i, position, cost)?;
        }
        Ok(())
    }

    /// Makes `next` follow `prev`.
    fn connect_intervals(&mut self, prev: Option<usize>, next: Option<usize>) -> Checked {
        match prev {
            Some(prev) => self.intervals.at_mut(prev)?.next = next,
            None => self.head = next,
        }
        if let Some(next) = next {
            self.intervals.at_mut(next)?.previous = prev;
        }
        Ok(())
    }

    fn pop_interval(&mut self, interval: usize) -> Checked {
        let CostInterval { previous, next, .. } = self.intervals.at(interval)?;
        self.connect_intervals(previous, next)?;
        self.free_intervals.push(interval);
        Ok(())
    }

    /// Takes into the cost of pixel `i` the intervals that it is in. With `do_clean_intervals`, drops those that end
    /// before it.
    fn update_cost_at_index(&mut self, i: usize, do_clean_intervals: bool) -> Checked {
        let mut current = self.head;
        while let Some(index) = current {
            let interval = self.intervals.at(index)?;
            if interval.start > i {
                break;
            }
            if interval.end <= i {
                if do_clean_intervals {
                    self.pop_interval(index)?;
                }
            } else {
                self.update_cost(i, interval.index, interval.cost)?;
            }
            current = interval.next;
        }
        Ok(())
    }

    /// Puts `current`, which is not in the list, where its `start` says. The search begins at `previous`.
    fn position_orphan_interval(&mut self, current: usize, previous: Option<usize>) -> Checked {
        let start = self.intervals.at(current)?.start;
        let mut previous = previous.or(self.head);
        while let Some(index) = previous {
            let interval = self.intervals.at(index)?;
            if start >= interval.start {
                break;
            }
            previous = interval.previous;
        }
        while let Some(index) = previous {
            match self.intervals.at(index)?.next {
                Some(next) if self.intervals.at(next)?.start < start => previous = Some(next),
                _ => break,
            }
        }
        let next = match previous {
            Some(index) => self.intervals.at(index)?.next,
            None => self.head,
        };
        self.connect_intervals(Some(current), next)?;
        self.connect_intervals(previous, Some(current))
    }

    /// Adds an interval to the list. `interval_in` is one that is near its place.
    fn insert_interval(
        &mut self,
        interval_in: Option<usize>,
        cost: i64,
        position: usize,
        start: usize,
        end: usize,
    ) -> Checked {
        if start >= end {
            return Ok(());
        }
        let Some(interval_new) = self.free_intervals.pop() else {
            return self.update_cost_per_interval(start, end, position, cost);
        };
        self.intervals.put(
            interval_new,
            CostInterval {
                cost,
                start,
                end,
                index: position,
                previous: None,
                next: None,
            },
        )?;
        self.position_orphan_interval(interval_new, interval_in)
    }

    /// There is a copy of `len` pixels from `position` on, which costs `distance_cost` plus the cost of the length
    /// that is made use of.
    fn push_interval(&mut self, distance_cost: i64, position: usize, len: usize) -> Checked {
        // Not worth the trouble with the intervals.
        const SKIP_DISTANCE: usize = 10;
        if len < SKIP_DISTANCE {
            for k in 0..len {
                let cost = distance_cost + self.cost_cache.at(k)?;
                self.update_cost(position + k, position, cost)?;
            }
            return Ok(());
        }

        let mut interval = self.head;
        for i in 0..self.cache_intervals.len() {
            let cache_interval = self.cache_intervals.at(i)?;
            if cache_interval.start >= len {
                break;
            }
            // What is left to place of this range of lengths.
            let mut start = position + cache_interval.start;
            let end = position + cache_interval.end.min(len);
            let cost = distance_cost + cache_interval.cost;

            while let Some(index) = interval {
                let old = self.intervals.at(index)?;
                if old.start >= end {
                    break;
                }
                if start >= old.end {
                    interval = old.next;
                    continue;
                }
                if cost >= old.cost {
                    // The old one stays. The new one keeps what comes before it and goes on after it.
                    self.insert_interval(interval, cost, position, start, old.start)?;
                    start = old.end;
                    if start >= end {
                        break;
                    }
                } else if start <= old.start {
                    if old.end <= end {
                        self.pop_interval(index)?;
                    } else {
                        self.intervals.at_mut(index)?.start = end;
                        break;
                    }
                } else {
                    self.intervals.at_mut(index)?.end = start;
                    if end < old.end {
                        // The new one splits the old one.
                        self.insert_interval(interval, old.cost, old.index, end, old.end)?;
                        interval = self.intervals.at(index)?.next;
                        break;
                    }
                }
                interval = old.next;
            }
            self.insert_interval(interval, cost, position, start, end)?;
        }
        Ok(())
    }
}

/// `AddSingleLiteralWithCostModel`: pixel `idx` can be reached from the one before, which costs `prev_cost`.
#[inline]
fn add_single_literal_with_cost_model(
    color: u32,
    hashers: Option<&mut ColorCache>,
    cost_model: &CostModel,
    idx: usize,
    prev_cost: i64,
    manager: &mut CostManager<'_>,
) -> Checked {
    let ix = match &hashers {
        Some(hashers) => hashers.contains(color)?,
        None => None,
    };
    let cost_val = prev_cost
        + match ix {
            Some(ix) => div_round::<100>(cost_model.get_cache_cost(ix)? * 68),
            None => {
                if let Some(hashers) = hashers {
                    hashers.insert(color)?;
                }
                div_round::<100>(cost_model.get_literal_cost(color)? * 82)
            }
        };
    manager.update_cost(idx, idx, cost_val)
}

/// Sets `dist_array` to the length of the last step of the cheapest way to each pixel.
fn backward_references_hash_chain_distance_only(
    xsize: usize,
    argb: &[u32],
    cache_bits: u32,
    hash_chain: &HashChain,
    refs: &BackwardRefs,
    dist_array: &mut [u16],
) -> Result<(), EncodeError> {
    let pix_count = argb.len();
    let cost_model = CostModel::new(xsize, cache_bits, refs)?;
    let mut hashers = match cache_bits {
        0 => None,
        _ => Some(ColorCache::new(cache_bits)?),
    };
    let mut cost_manager = CostManager::new(dist_array, &cost_model)?;
    let mut offset_prev = None;
    let mut len_prev = 0;
    let mut offset_cost = 0;
    let mut first_offset_is_constant = false;
    let mut reach = 0;

    add_single_literal_with_cost_model(
        argb.at(0)?,
        hashers.as_mut(),
        &cost_model,
        0,
        0,
        &mut cost_manager,
    )?;

    for i in 1..pix_count {
        let prev_cost = cost_manager.costs.at(i - 1)?;
        let (offset, len) = hash_chain.find_copy(i)?;

        add_single_literal_with_cost_model(
            argb.at(i)?,
            hashers.as_mut(),
            &cost_model,
            i,
            prev_cost,
            &mut cost_manager,
        )?;

        if len >= 2 {
            if Some(offset) != offset_prev {
                let code = distance_to_plane_code(xsize, offset as u32);
                offset_cost = cost_model.get_distance_cost(code)?;
                first_offset_is_constant = true;
                cost_manager.push_interval(prev_cost + offset_cost, i, len)?;
            } else {
                // A stretch of pixels that all copy from the same distance, as in an area of one colour. The interval
                // of each would be the one of the pixel before, moved by one.
                if first_offset_is_constant {
                    reach = (i + len_prev).checked_sub(2).ok_or(Bug)?;
                    first_offset_is_constant = false;
                }

                if i + len - 1 > reach {
                    // Only the last pixel up to `reach + 1` with this distance gets further.
                    let mut j = i;
                    let mut len_j = 0;
                    while j <= reach {
                        let (offset_j, len_next) = hash_chain.find_copy(j + 1)?;
                        len_j = len_next;
                        if offset_j != offset {
                            len_j = hash_chain.find_length(j)?;
                            break;
                        }
                        j += 1;
                    }
                    cost_manager.update_cost_at_index(j - 1, false)?;
                    cost_manager.update_cost_at_index(j, false)?;

                    let cost = cost_manager.costs.at(j - 1)? + offset_cost;
                    cost_manager.push_interval(cost, j, len_j)?;
                    reach = (j + len_j).checked_sub(1).ok_or(Bug)?;
                }
            }
        }

        cost_manager.update_cost_at_index(i, true)?;
        offset_prev = Some(offset);
        len_prev = len;
    }
    Ok(())
}

/// Follows the steps back from the last pixel. Returns where in `dist_array` the steps of the path start: they are
/// packed at its end.
fn trace_backwards(dist_array: &mut [u16]) -> Checked<usize> {
    let mut path = dist_array.len();
    // One more than the pixel that the path has got back to.
    let mut cur = dist_array.len();
    while cur > 0 {
        let k = dist_array.at(cur - 1)?;
        if k == 0 {
            return Err(Bug);
        }
        path -= 1;
        dist_array.put(path, k)?;
        cur = cur.checked_sub(k.into()).ok_or(Bug)?;
    }
    Ok(path)
}

fn backward_references_hash_chain_follow_chosen_path(
    argb: &[u32],
    cache_bits: u32,
    chosen_path: &[u16],
    hash_chain: &HashChain,
    refs: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let mut hashers = match cache_bits {
        0 => None,
        _ => Some(ColorCache::new(cache_bits)?),
    };
    refs.clear();
    let mut i = 0;
    for &len in chosen_path {
        let len = usize::from(len);
        if len != 1 {
            refs.push_copy(hash_chain.find_offset(i)?, len)?;
            if let Some(hashers) = &mut hashers {
                for &pixel in argb.sub(i..i + len)? {
                    hashers.insert(pixel)?;
                }
            }
        } else {
            let pixel = argb.at(i)?;
            let idx = match &hashers {
                Some(hashers) => hashers.contains(pixel)?,
                None => None,
            };
            refs.push(match idx {
                Some(idx) => PixOrCopy::CacheIdx(idx),
                None => {
                    if let Some(hashers) = &mut hashers {
                        hashers.insert(pixel)?;
                    }
                    PixOrCopy::Literal(pixel)
                }
            })?;
        }
        i += len;
    }
    Ok(())
}

/// `VP8LBackwardReferencesTraceBackwards`: `refs_src` says how frequent the symbols are.
pub(crate) fn backward_references_trace_backwards(
    xsize: usize,
    argb: &[u32],
    cache_bits: u32,
    hash_chain: &HashChain,
    refs_src: &BackwardRefs,
    refs_dst: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let mut dist_array = try_vec(0u16, argb.len())?;
    backward_references_hash_chain_distance_only(
        xsize,
        argb,
        cache_bits,
        hash_chain,
        refs_src,
        &mut dist_array,
    )?;
    let path = trace_backwards(&mut dist_array)?;
    backward_references_hash_chain_follow_chosen_path(
        argb,
        cache_bits,
        dist_array.sub(path..)?,
        hash_chain,
        refs_dst,
    )
}
