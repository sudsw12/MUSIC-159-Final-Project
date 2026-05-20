export function createVisibilityState(stems) {
  return Object.fromEntries(stems.map((stem) => [stem.id, true]));
}

export function setStemVisible(visibility, stemId, visible) {
  visibility[stemId] = Boolean(visible);
  return visibility;
}

export function isolateStem(visibility, stems, stemId) {
  stems.forEach((stem) => {
    visibility[stem.id] = stem.id === stemId;
  });
  return visibility;
}

export function showAllStems(visibility, stems) {
  stems.forEach((stem) => {
    visibility[stem.id] = true;
  });
  return visibility;
}
