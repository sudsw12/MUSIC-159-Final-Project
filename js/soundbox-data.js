export const STEMS = [
  {
    id: 'vocals',
    name: 'Vocals',
    url: 'audio/vocals.mp3',
    color: '#f0766b',
    shortLabel: 'Vox',
  },
  {
    id: 'hihat',
    name: 'Hi-Hat',
    url: 'audio/hihat.mp3',
    color: '#e05e8a',
    shortLabel: 'Hat',
  },
  {
    id: 'bass',
    name: 'Bass',
    url: 'audio/bass.mp3',
    color: '#9b6dff',
    shortLabel: 'Bass',
  },
  {
    id: 'melody',
    name: 'Melody',
    url: 'audio/melody.mp3',
    color: '#5b87f5',
    shortLabel: 'Mel',
  },
  {
    id: 'kick',
    name: 'Kick',
    url: 'audio/kick.mp3',
    color: '#4fd1d9',
    shortLabel: 'Kick',
  },
];

export const SECTION_MARKERS = [
  { id: 'intro', time: 0, label: 'Intro' },
  { id: 'verse_1', time: 14, label: 'Verse 1' },
  { id: 'refrain_1', time: 30, label: 'Refrain' },
  { id: 'verse_2', time: 46, label: 'Verse 2' },
  { id: 'refrain_2', time: 61, label: 'Refrain' },
  { id: 'verse_3', time: 85, label: 'Verse 3' },
  { id: 'refrain_3', time: 100, label: 'Refrain' },
  { id: 'breakdown', time: 148, label: 'Breakdown' },
  { id: 'outro', time: 210, label: 'Outro' },
];

export const DEPTH_PROFILES = {
  vocals: {
    zone: 'Intimate zone',
    baseDepth: 2.15,
    breathAmount: 0.32,
    restPan: 0,
    restRegisterNorm: 0.48,
    note: 'Breathy, center-panned falsetto sits closest to the listener and anchors the intimate proxemic bubble.',
  },
  melody: {
    zone: 'Personal zone',
    baseDepth: 0.35,
    breathAmount: 0.24,
    restPan: 0,
    restRegisterNorm: 0.55,
    note: 'Filtered synth texture hovers behind the voice as a warm, nostalgic mid-distance layer.',
  },
  bass: {
    zone: 'Personal zone',
    baseDepth: 0.05,
    breathAmount: 0.22,
    restPan: 0,
    restRegisterNorm: 0.18,
    note: 'The bass occupies a grounded, warm layer in the personal zone rather than pushing toward the front.',
  },
  kick: {
    zone: 'Personal-to-social zone',
    baseDepth: -0.55,
    breathAmount: 0.2,
    restPan: 0,
    restRegisterNorm: 0.13,
    note: 'The soft transient makes the kick feel physically centered but perceptually set back.',
  },
  hihat: {
    zone: 'Social zone',
    baseDepth: -1.35,
    breathAmount: 0.18,
    restPan: 0.18,
    restRegisterNorm: 0.86,
    note: 'The thin upper-register hi-hat sits farther back and slightly wide in the song’s spatial field.',
  },
};

export const SOUNDSPACE = {
  xMax: 3.4,
  yMin: -1.35,
  yMax: 2.85,
  zMin: -2.6,
  zMax: 2.65,
  minRegisterHz: 80,
  maxRegisterHz: 8000,
};

export function getStemById(stemId) {
  return STEMS.find((stem) => stem.id === stemId) || null;
}
