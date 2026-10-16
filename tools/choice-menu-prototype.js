import assert from 'node:assert/strict';
import { hash } from '../src/core/files.js';
import { SUPPORTED_GAME_HASH, patchDirectLevelExe } from '../src/core/playtest.js';

// Experimental, deliberately NOT used by Playtest or the script generator yet.
// See research/dialogue-choices.md for the contract, native evidence and limits.
// Accepts an original, exact GOG 1.2 image; returns a new in-memory test image.
// No filesystem writes, redistributable executable or simulated player input.
export const choiceMenuMarkerBase = 0x57424300;
export function patchScopedChoiceMenu(source) {
  assert.equal(hash(source), SUPPORTED_GAME_HASH, 'Choice menu prototype requires the verified original GOG 1.2 executable.');
  const bytes = patchDirectLevelExe(source);
  const base = 0x6222b0, context = 0x6d9dd8;
  const parts = [], labels = new Map(), fixups = [];
  let size = 0;
  const emit = hex => { const b = Buffer.from(hex, 'hex'); parts.push(b); size += b.length; };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); emit(b.toString('hex')); };
  const branch = (opcode, destination) => { emit(opcode); fixups.push({ at: size, destination }); emit('00000000'); };
  const label = name => { assert(!labels.has(name)); labels.set(name, base + size); };
  const skip = condition => branch(condition, 'done');

  // HUMAN_CANDIE parses one integer but is otherwise a no-op in this image.
  // EBP is C_program, ESI its instruction vector; only base + [2..4] is reserved.
  emit('8b4d1c518bce'); branch('e8', 0x47be10);
  emit('8b40048b002d'); u32(choiceMenuMarkerBase);
  emit('83f802'); branch('0f82', 0x479996);
  emit('83f804'); branch('0f87', 0x479996);

  // Save all registers. Stack context = { requesting program, count, consumed }.
  emit('6083ec0c892c2489442404c744240800000000');
  emit('39455c'); skip('0f82'); // Enough actor registers?
  emit('8b7d5885ff'); skip('0f84');
  emit('31d2'); label('validate');
  emit('8b349785f6'); skip('0f84');
  emit('837e1005'); skip('0f85'); // C_detector, kind 5.
  emit('80bedd00000001'); skip('0f85'); // Registered for use.
  emit('39b6fc000000'); skip('0f85'); // Embedded using-object belongs to it.
  emit('6683be0801000001'); skip('0f85'); // Native action type 1.
  emit('8b868000000085c0'); skip('0f84');
  emit('8b8e840000002bc8c1e9038b9e8c00000039cb'); skip('0f83');
  emit('833cd820'); skip('0f85'); // PC still at GOG DETECTOR_WAITFORUSE 0x20.
  emit('31db'); label('unique');
  emit('39d3'); branch('0f83', 'uniqueDone');
  emit('39349f'); skip('0f84');
  emit('43'); branch('e9', 'unique');
  label('uniqueDone'); emit('423b542404'); branch('0f82', 'validate');

  // Do not replace another extension request's live context.
  emit('833d'); u32(context); emit('00'); skip('0f85');
  emit('8b0d8c78630085c9'); skip('0f84');
  branch('e8', 0x47ae50); emit('85c0'); skip('0f84');
  emit('8bc8'); branch('e8', 0x47b520); emit('85c0'); skip('0f84');
  for (const offset of [0x98, 0x9c, 0x6f8, 0x700]) {
    emit('83b8'); u32(offset); emit('00'); skip('0f85');
  }
  // Controls and life flags are BYTES; adjacent bytes are unrelated state.
  emit('80b8da0a000000'); skip('0f85');
  emit('80785d00'); skip('0f84');
  emit('80785e00'); skip('0f85');
  emit('8925'); u32(context);
  emit('8bc8'); branch('e8', 0x594300); // Original on-foot action handler.
  emit('c705'); u32(context); u32(0);
  label('done'); emit('83c40c61'); branch('e9', 0x479996);

  // Replace just the handler's gather CALL. Ordinary calls tail into the original.
  // A nested gather after this request was consumed also uses normal gathering.
  label('gather'); emit('833d'); u32(context); emit('00'); branch('0f84', 0x55e180);
  emit('558bec5356578b1d'); u32(context);
  emit('837b0800'); branch('0f85', 'delegate');
  emit('c74308010000008b7d10');
  // This exact callsite supplies a fresh empty vector. Its native caller frees it.
  emit('8b4304c1e00450'); branch('e8', 0x6106fc); // operator_new(count * 16)
  emit('83c40485c0'); branch('0f84', 'gatherDone');
  emit('8947048b5304c1e20403d089570889570c8bd08b338b765831c9');
  label('fill');
  // { type: 1, text ID, distance: 0, borrowed S_using_object* }, register order.
  emit('8b048ec702010000008bb80c010000897a04c74208000000008d80e000000089420c83c210413b4b04');
  branch('0f82', 'fill');
  label('gatherDone'); emit('5f5e5b5dc21000');
  label('delegate'); emit('5f5e5b5d'); branch('e9', 0x55e180);

  const code = Buffer.concat(parts);
  for (const fixup of fixups) {
    const destination = typeof fixup.destination === 'string' ? labels.get(fixup.destination) : fixup.destination;
    assert(Number.isSafeInteger(destination), 'Unresolved prototype branch.');
    code.writeInt32LE(destination - (base + fixup.at + 4), fixup.at);
  }
  assert(base + code.length <= 0x623000);
  assert(bytes.subarray(base - 0x400000, base - 0x400000 + code.length).every(b => b === 0));
  assert.equal(bytes.readUInt32LE(0x79f38), 0x479996);
  assert(bytes.subarray(0x1947b8, 0x1947bd).equals(Buffer.from('e8c399fcff', 'hex')));
  const pe = bytes.readUInt32LE(0x3c), section = pe + 24 + bytes.readUInt16LE(pe + 20), data = section + 80;
  assert.equal(bytes.subarray(section, section + 5).toString(), '.text');
  assert.equal(bytes.subarray(data, data + 5).toString(), '.data');
  assert.equal(bytes.readUInt32LE(section + 8), 0x2212aa);
  assert.equal(bytes.readUInt32LE(data + 8), 0xabdd8);
  assert.equal(bytes.readUInt32LE(data + 12), 0x22e000);
  assert.equal((bytes.readUInt32LE(data + 36) & 0x80000000) >>> 0, 0x80000000);
  // Four zero-initialized bytes at the BSS tail, within the same image page.
  bytes.writeUInt32LE(base - 0x401000 + code.length, section + 8);
  bytes.writeUInt32LE(0xabddc, data + 8);
  code.copy(bytes, base - 0x400000);
  bytes.writeUInt32LE(base, 0x79f38);
  bytes.writeInt32LE(labels.get('gather') - 0x5947bd, 0x1947b9);
  return { bytes, code, base, context, labels: Object.fromEntries(labels), markerBase: choiceMenuMarkerBase };
}
