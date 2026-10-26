// Three cohesive worlds. Sky/light colors are blended by time of day (day / dusk / night).
export const THEMES = {
  island: {
    id: 'island', name: 'Sunset Isles', icon: 'sunset', floating: true, roof: 'spire', stars: 'night',
    sky: { day: ['#4f9cf0', '#ffdcc0'], dusk: ['#4a3b8f', '#ff8a65'], night: ['#0a0b2c', '#3b2a68'] },
    light: { day: '#fff0d8', dusk: '#ff9561', night: '#9fb2ff' },
    plotTop: '#9bd98c', plotRim: '#6fbf7a', rock: '#8a6f7a', ground: null,
    walls: ['#fff1e0', '#ffd9c7', '#f2e0ff', '#ffe8a8'], roofs: ['#ff7a90', '#7b6cf6', '#ff9f5a', '#4fc3c8'],
    trees: ['#5fcf8a', '#ff9ec4', '#ffc15e'], hemiGround: '#ffb59a',
  },
  village: {
    id: 'village', name: 'Cozy Night Village', icon: 'home', floating: false, roof: 'gable', stars: 'night',
    sky: { day: ['#6bb8ff', '#eaf4d8'], dusk: ['#3b3f87', '#f4a261'], night: ['#050818', '#1a2b4d'] },
    light: { day: '#fff4de', dusk: '#ffa766', night: '#8fa8ff' },
    plotTop: '#8ccf72', plotRim: '#7a5e48', rock: '#6a5240', ground: '#4f7f4a',
    walls: ['#f6e7cf', '#e9d2b0', '#d9e6d0', '#f4d9c4'], roofs: ['#c8553d', '#8c5a3c', '#b8473a', '#5b6f8f'],
    trees: ['#2f7d4f', '#3b8f5c', '#5a9a4a'], hemiGround: '#5f8a55',
  },
  moon: {
    id: 'moon', name: 'Moon Colony', icon: 'moon', floating: false, roof: 'dome', stars: 'always',
    sky: { day: ['#04050e', '#16204a'], dusk: ['#03040a', '#241a3f'], night: ['#010208', '#0a1030'] },
    light: { day: '#ffffff', dusk: '#ffd9b8', night: '#7f95ff' },
    plotTop: '#c9ccd8', plotRim: '#9a9dab', rock: '#7d8090', ground: '#a3a6b3',
    walls: ['#e9edf5', '#d5dbe8', '#f1e9e4', '#cfe0ee'], roofs: ['#8fd3ff', '#9fe8d4', '#c8b6ff', '#ffd08a'],
    trees: ['#7ad7f0', '#9bf0c8', '#c8a7ff'], hemiGround: '#7a7d90',
  },
};

export const STATUS = {
  working:  { label: 'Working',   color: '#4ade80' },
  needs:    { label: 'Needs you', color: '#fbbf24' },
  idle:     { label: 'Idle',      color: '#94a3b8' },
  sleeping: { label: 'Sleeping',  color: '#7c8cf5' },
};
export const TOOLS = {
  claude:   { label: 'Claude Code', color: '#e8825c', accent: '#ffb199' },
  codex:    { label: 'Codex', color: '#ffb347', accent: '#ffd9a0' },
  opencode: { label: 'OpenCode',    color: '#2fb5a6', accent: '#8fe3d8' },
};
