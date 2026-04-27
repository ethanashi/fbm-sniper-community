/**
 * Task Queue / Concurrency Limiter
 */
export async function mapLimit(items, limit, fn) {
  const results = [];
  const queue = [...items];
  const active = new Set();

  return new Promise((resolve, reject) => {
    function next() {
      if (queue.length === 0 && active.size === 0) {
        return resolve(results);
      }

      while (active.size < limit && queue.length > 0) {
        const item = queue.shift();
        const p = fn(item).then(res => {
          results.push(res);
          active.delete(p);
          next();
        }).catch(err => {
          active.delete(p);
          reject(err);
        });
        active.add(p);
      }
    }
    next();
  });
}
