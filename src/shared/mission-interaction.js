const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);

// FRM_LINKTO's actual operand order is child, parent (engine opcode 0x10).
// A detector attached to the model follows its NPC and offers the ordinary
// action menu there. No changes to the NPC's own AI/choice program are needed.
export function attachedInteraction(humanName, { frameOffset = 0, floatOffset = 0 } = {}) {
  if (!validName(humanName)) throw new Error('Akce: vyberte platnou NPC postavu.');
  const child = frameOffset + 1;
  return `findframe ${frameOffset}, "${humanName}"\nfindframe ${child}, ""\nfrm_linkto ${child}, ${frameOffset}\nlet flt[${floatOffset}] = 0\nlet flt[${floatOffset + 1}] = 1\nlet flt[${floatOffset + 2}] = 0\nfrm_setpos ${child}, ${floatOffset}\n`;
}
