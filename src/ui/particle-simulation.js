import { Vector3, Quaternion } from 'three';

const zero = [0, 0, 0], one = [1, 1, 1], forward = new Vector3(0, 0, 1);
const clamp = n => Math.max(0, Math.min(1, n));
const fields = node => {
  if (node.warnings?.length) throw Error('Definice obsahuje nerozpoznané bloky; náhled jejich účinek neumí vyhodnotit.');
  return Object.fromEntries(node.entries.map(entry => {
    if (entry.value === null || typeof entry.value === 'number' && !Number.isFinite(entry.value) || Array.isArray(entry.value) && (entry.value.length !== 3 || entry.value.some(n => !Number.isFinite(n)))) throw Error('Efekt obsahuje neplatný číselný parametr.');
    return [entry.key, Array.isArray(entry.value) ? [...entry.value] : entry.value];
  }));
};
const vector = values => new Vector3(...values);

// Bounded, deterministic editor preview. Fixed 10 ms steps make pause/seek and
// restart reproducible; this is not the frame-dependent LS3D runtime itself.
// PC: particle_create, particle_begin_phase, particle_tick, particle_effect_tick.
export class ParticleSimulation {
  constructor(type, { maxParticles = 256, direction = [0, 1, 0] } = {}) {
    if (!Number.isInteger(maxParticles) || maxParticles < 1 || maxParticles > 2048) throw Error('Neplatný limit částic.');
    if (!Array.isArray(direction) || direction.length !== 3 || direction.some(n => !Number.isFinite(n))) throw Error('Neplatný směr efektu.');
    this.maxParticles = maxParticles; this.direction = vector(direction); this.definition = fields(type);
    this.definitions = type.children.map(node => ({ ...fields(node), id: node.id, startDelay: Object.hasOwn(node.preview ?? {}, 'startDelay') ? node.preview.startDelay : 0, phases: node.children.map(fields) }));
    for (const emitter of this.definitions) {
      if (!emitter.phases.length) throw Error('Emitor nemá žádné fáze.');
      if (!Number.isFinite(emitter.startDelay)) throw Error('Neplatná prodleva emitoru.');
    }
    this.reset();
  }
  reset() {
    this.time = 0; this.targetTime = 0; this.nextId = 0; this.dropped = 0; this.particles = [];
    this.emitters = this.definitions.map((definition, index) => ({ definition, random: (0x9e3779b9 ^ Math.imul(index + 1, 2654435761)) >>> 0, clock: 0, elapsed: 0, rate: Math.max(0, definition.lifetime ?? 0), loops: Math.trunc(definition.parameter88 ?? 0), delay: 0, burst: true }));
    for (const emitter of this.emitters) this.emitBurst(emitter);
    return this;
  }
  random(emitter) {
    emitter.random = (Math.imul(emitter.random, 1664525) + 1013904223) >>> 0;
    return emitter.random / 4294967296 * 2 - 1;
  }
  varied(emitter, base = zero, spread = zero, shared = false) {
    const sample = shared ? this.random(emitter) : null;
    return vector(base.map((value, i) => value + (shared ? sample : this.random(emitter)) * spread[i]));
  }
  emitBurst(emitter) {
    if (!emitter.burst || emitter.delay > 0) return;
    emitter.burst = false; this.emit(emitter, Math.max(0, Math.trunc(emitter.definition.burst ?? 0)));
  }
  emit(emitter, count) {
    const available = Math.max(0, this.maxParticles - this.particles.length), admitted = Math.min(available, count);
    this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + count - admitted);
    for (let i = 0; i < admitted; i++) {
      const d = emitter.definition, direction = vector(d.direction ?? zero);
      if (direction.lengthSq() < 1e-16) direction.copy(this.direction);
      direction.add(this.varied(emitter, zero, d.directionSpread ?? zero)).multiplyScalar((d.speed ?? 1) + this.random(emitter) * (d.speedSpread ?? 0));
      const particle = { id: this.nextId++, emitter, phase: -1, position: this.varied(emitter, d.position ?? zero, d.positionSpread ?? zero).add(vector(this.definition.vector1 ?? zero)), velocity: direction, scale: this.varied(emitter, d.scale ?? one, d.scaleSpread ?? zero, true), alpha: clamp((d.alpha ?? 1) + this.random(emitter) * (d.alphaSpread ?? 0)), rotation: new Quaternion() };
      this.beginPhase(particle); this.particles.push(particle);
    }
  }
  beginPhase(particle) {
    const emitter = particle.emitter, phase = emitter.definition.phases[++particle.phase];
    if (!phase) return false;
    particle.remaining = particle.duration = Math.max(1, Math.trunc((phase.duration ?? 1) + this.random(emitter) * (phase.durationSpread ?? 0)));
    particle.startScale = particle.scale.clone(); particle.endScale = this.varied(emitter, phase.scale ?? one, phase.scaleSpread ?? zero, true).max(vector(zero));
    particle.startAlpha = particle.alpha; particle.endAlpha = clamp((phase.alpha ?? 0) + this.random(emitter) * (phase.alphaSpread ?? 0));
    particle.acceleration = (phase.spin ?? 0) + this.random(emitter) * (phase.spinSpread ?? 0);
    const direction = this.varied(emitter, phase.direction ?? zero, phase.directionSpread ?? zero);
    particle.turn = direction.lengthSq() >= 1e-16 && particle.velocity.lengthSq() >= 1e-16;
    if (particle.turn) {
      particle.turnStart = new Quaternion().setFromUnitVectors(forward, particle.velocity.clone().normalize());
      particle.turnEnd = new Quaternion().setFromUnitVectors(forward, direction.normalize());
    }
    return true;
  }
  move(particle, ms) {
    const phase = particle.emitter.definition.phases[particle.phase], dt = ms / 1000;
    particle.remaining -= ms; const fraction = 1 - particle.remaining / particle.duration;
    if (particle.turn) {
      const speed = particle.velocity.length();
      particle.velocity.copy(forward).applyQuaternion(particle.turnStart.clone().slerp(particle.turnEnd, fraction)).multiplyScalar(speed);
    }
    if (!(phase.flags & 32)) particle.position.addScaledVector(particle.velocity, dt);
    if (phase.flags & 16) for (let i = 0; i < 3; i++) particle.rotation.multiply(new Quaternion().setFromAxisAngle(vector(one.map((_, j) => i === j ? 1 : 0)), (phase.rotation?.[i] ?? 0) * dt));
    particle.scale.lerpVectors(particle.startScale, particle.endScale, fraction); particle.alpha = particle.startAlpha + (particle.endAlpha - particle.startAlpha) * fraction;
    if (particle.acceleration && particle.velocity.lengthSq() > 1e-16) particle.velocity.addScaledVector(particle.velocity.clone().normalize(), particle.acceleration * dt);
    if (phase.flags & 2) particle.velocity.y -= (phase.gravity ?? 9.8) * dt;
  }
  step() {
    // Retire before spawning, so the particle budget is not lost to dead frames.
    this.particles = this.particles.filter(particle => {
      let remaining = 10;
      while (remaining > 0) {
        const ms = Math.min(remaining, particle.remaining); this.move(particle, ms); remaining -= ms;
        if (particle.remaining <= 0 && !this.beginPhase(particle)) return false;
      }
      return true;
    });
    for (const emitter of this.emitters) {
      const activeMs = Math.max(0, 10 - emitter.delay); emitter.delay = Math.max(0, emitter.delay - 10); this.emitBurst(emitter);
      if (!activeMs) continue;
      emitter.elapsed += activeMs;
      if (emitter.rate > 0) {
        emitter.clock += activeMs * emitter.rate / 1000;
        const count = Math.floor(emitter.clock + 1e-9); emitter.clock = Math.max(0, emitter.clock - count); this.emit(emitter, count);
        if (emitter.elapsed > (emitter.definition.parameter84 ?? 0)) emitter.rate = Math.max(0, emitter.rate - (emitter.definition.decay ?? 0) * activeMs / 1000);
      }
      if (!emitter.rate && (emitter.loops > 1 || emitter.loops === -1)) {
        if (emitter.loops > 1) emitter.loops--;
        emitter.rate = Math.max(0, emitter.definition.lifetime ?? 0); emitter.elapsed = emitter.clock = 0; emitter.delay = Math.max(0, emitter.definition.startDelay); emitter.burst = true;
      }
    }
    this.time += 10;
  }
  seek(ms) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) throw Error('Náhled podporuje čas 0–60 sekund.');
    if (ms < this.time) this.reset();
    this.targetTime = ms;
    while (this.time + 10 <= ms + 1e-7) this.step();
    return this;
  }
}
