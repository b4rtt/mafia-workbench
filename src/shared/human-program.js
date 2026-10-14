// Keep an idle NPC's actor ticking; `end` halts its owner, including collisions.
export const HUMAN_IDLE_SCRIPT = 'label 1\r\nwait 1000\r\ngoto 1\r\n';

// A deliberately narrow diagnosis, not a control-flow analysis of custom code.
export function isBareHumanEnd(code) {
  return typeof code === 'string' && code.split(/\r?\n/).map(line => line.replace(/\/\/.*$/, '').trim()).filter(Boolean).join(' ').toLowerCase() === 'end';
}
