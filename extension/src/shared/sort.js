export function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const left  = key === 'name' ? a.name : a.stats[key];
    const right = key === 'name' ? b.name : b.stats[key];
    const result = typeof left === 'string'
      ? left.localeCompare(right)
      : Number(left) - Number(right);
    return dir === 'asc' ? result : -result;
  });
}
