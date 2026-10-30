import { edition } from './editions.js';
import classic from './2014/rules.js';
import revised from './2024/rules.js';

const implementations = Object.freeze({ 2014: classic, 2024: revised });

export function rulesFor(id) {
  edition(id);
  return implementations[id];
}
