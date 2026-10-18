// iOS light-appearance colors (app.json pins userInterfaceStyle to "light").
// Text colors use Apple's increased-contrast values where the defaults fall under 4.5:1 on white.
export const colors = {
  background: '#ffffff',
  groupedBackground: '#f2f2f7',
  cell: '#ffffff', // rows inside a grouped background
  fill: 'rgba(120,120,128,0.16)',
  label: '#000000',
  secondaryLabel: '#6c6c70', // systemGray's 60% label is only ~3.5:1 on white
  separator: 'rgba(60,60,67,0.29)',
  tint: '#0066d6', // system blue #007aff is ~4.0:1 on white
  destructive: '#d70015',
  goodText: '#248a3d', // green that's readable as text
};

// Verdict fills and rings. Always paired with black text or a dark scrim, never used as text on white.
export const verdictColors = {
  good: '#34c759',
  caution: '#ffcc00',
  bad: '#ff3b30',
};

// Surfaces drawn over the camera stay dark, like Apple Camera.
export const cameraColors = {
  surface: '#2c2c2e',
  label: '#ffffff',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  tint: '#409cff',
};
