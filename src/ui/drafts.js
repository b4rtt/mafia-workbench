// All editors share these drafts, including programmatic changes from gizmos.
// Notify only when the count changes: launch availability depends on emptiness.
export class Drafts extends Map {
  constructor(changed) { super(); this.changed = changed; }
  set(key, value) { const size=this.size; super.set(key,value); if(this.size!==size)this.changed(); return this; }
  delete(key) { const removed=super.delete(key); if(removed)this.changed(); return removed; }
  clear() { const size=this.size; super.clear(); if(size)this.changed(); }
}
