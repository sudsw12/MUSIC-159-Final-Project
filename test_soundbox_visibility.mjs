import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createVisibilityState,
  isolateStem,
  setStemVisible,
  showAllStems,
} from './js/soundbox-visibility.js';

const stems = [
  { id: 'vocals' },
  { id: 'hihat' },
  { id: 'bass' },
];

test('createVisibilityState starts every stem visible', () => {
  assert.deepEqual(createVisibilityState(stems), {
    vocals: true,
    hihat: true,
    bass: true,
  });
});

test('isolateStem leaves only the requested stem visible', () => {
  const visibility = createVisibilityState(stems);

  isolateStem(visibility, stems, 'bass');

  assert.deepEqual(visibility, {
    vocals: false,
    hihat: false,
    bass: true,
  });
});

test('showAllStems restores every stem after isolation or manual hiding', () => {
  const visibility = createVisibilityState(stems);
  isolateStem(visibility, stems, 'vocals');
  setStemVisible(visibility, 'hihat', false);

  showAllStems(visibility, stems);

  assert.deepEqual(visibility, {
    vocals: true,
    hihat: true,
    bass: true,
  });
});
