// check.bin references array positions, not the (possibly repeated) stored ID.
// This is a graph diagnostic, not the engine's AI/collision simulation.
export function findNavigationRoute({ positions, edges, types }, from, to, mask = 1) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || !positions[from] || !positions[to]) throw new Error('Vyberte začátek a cíl v rozsahu navigačních bodů.');
  if (!Number.isInteger(mask) || !(mask & 0x17) || (mask & ~0x17)) throw new Error('Vyberte podporovaný typ vazeb.');
  if (edges.length !== types.length) throw new Error('Neúplné typy navigačních vazeb.');
  const outgoing = positions.map(position => {
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('Navigační bod nemá platnou pozici XYZ.');
    return [];
  });
  edges.forEach(([source, target], index) => {
    const type = types[index];
    if (!Number.isInteger(source) || !Number.isInteger(target) || !positions[source] || !positions[target] || !Number.isInteger(type) || type < 0 || type > 65535) throw new Error('Neplatný cíl nebo typ navigační vazby.');
    if (!(type & 0x80) && (type & mask)) outgoing[source].push(target);
  });
  const distances = new Float64Array(positions.length).fill(Infinity), previous = new Int32Array(positions.length).fill(-1), heap = [];
  const less = (a, b) => a.distance < b.distance || (a.distance === b.distance && a.index < b.index);
  function push(value) {
    let i = heap.length; heap.push(value);
    while (i) { const parent = (i - 1) >> 1; if (!less(value, heap[parent])) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = value;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1; if (child + 1 < heap.length && less(heap[child + 1], heap[child])) child++;
        if (!less(heap[child], last)) break; heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  distances[from] = 0; push({ index: from, distance: 0 });
  while (heap.length) {
    const { index, distance } = pop(); if (distance !== distances[index]) continue;
    if (index === to) {
      const indices = []; for (let i = to; i !== -1; i = previous[i]) indices.push(i);
      return { indices: indices.reverse(), distance };
    }
    for (const target of outgoing[index]) {
      const a = positions[index], b = positions[target], next = distance + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (next < distances[target]) { distances[target] = next; previous[target] = index; push({ index: target, distance: next }); }
    }
  }
  return { indices: [], distance: null };
}
