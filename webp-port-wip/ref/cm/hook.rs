/// Test hook (private copy only): the cost manager driven directly.
pub struct Hook {
    dist: Vec<u16>,
    model: CostModel,
}
pub enum Op {
    Literal(usize, i64),
    Push(i64, usize, usize),
    Update(usize, bool),
}
impl Hook {
    pub fn new(n: usize, len_costs: &[u32; 24]) -> Self {
        let mut literal = vec![0u32; 256 + 24];
        for (d, s) in literal.iter_mut().skip(256).zip(len_costs) {
            *d = *s;
        }
        Hook { dist: vec![0; n], model: CostModel { alpha: [0; 256], red: [0; 256], blue: [0; 256], distance: [0; NUM_DISTANCE_CODES], literal } }
    }
    /// `next` sees the cost of a pixel and the number of intervals, and says what to do.
    pub fn run(&mut self, mut next: impl FnMut(&dyn Fn(usize) -> i64, usize) -> Option<Op>) -> crate::Result<(Vec<i64>, Vec<u16>)> {
        let costs = {
            let mut m = CostManager::new(&mut self.dist, &self.model)?;
            loop {
                let count = COST_CACHE_INTERVAL_SIZE_MAX - m.free_intervals.len();
                let op = { let c = &m.costs; next(&|i| c.get(i).copied().unwrap_or(0), count) };
                match op {
                    None => break,
                    Some(Op::Literal(i, cost)) => m.update_cost(i, i, cost)?,
                    Some(Op::Push(cost, position, len)) => m.push_interval(cost, position, len)?,
                    Some(Op::Update(i, clean)) => m.update_cost_at_index(i, clean)?,
                }
            }
            m.costs
        };
        Ok((costs, self.dist.clone()))
    }
}
