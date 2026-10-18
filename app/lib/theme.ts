// iOS dark-appearance system colors. Hex rather than PlatformColor because app.json pins
// userInterfaceStyle to "light", so PlatformColor('label') would resolve to light values.
export const colors = {
  background: '#000000',
  groupedBackground: '#1c1c1e',
  secondaryGroupedBackground: '#2c2c2e',
  fill: 'rgba(118,118,128,0.32)',
  label: '#ffffff',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  separator: 'rgba(84,84,88,0.65)',
  tint: '#0a84ff',
  tintOnFill: '#409cff', // tint text on gray fills; #0a84ff is under 4.5:1 there
  destructive: '#ff453a',
  good: '#30d158',
  caution: '#ffd60a',
};
