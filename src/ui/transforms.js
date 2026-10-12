import { Quaternion } from 'three';

// LS3D's stored WXYZ rotation maps to the inverse rotation in Three's
// column-vector transform. Coordinate reflection is handled by the viewport root.
export function fromLs3dRotation(value, target = new Quaternion()) {
  return target.set(-value[1], -value[2], -value[3], value[0]).normalize();
}
export function toLs3dRotation(value) {
  return [value.w, -value.x, -value.y, -value.z];
}
