export function sameJsonValue(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const prototype = Object.getPrototypeOf(left);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getPrototypeOf(right) !== prototype
  )
    return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}
