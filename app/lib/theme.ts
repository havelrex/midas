import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

// iOS system colors for each appearance. The user picks Light or Dark in Profile (ThemeProvider);
// app.json still pins the native appearance to light, so system sheets and the keyboard stay light
// unless a screen opts in.
// Text colors use Apple's increased-contrast values where the defaults fall under 4.5:1.
const light = {
  background: '#ffffff',
  groupedBackground: '#f2f2f7',
  cell: '#ffffff', // rows inside a grouped background
  fill: 'rgba(120,120,128,0.16)',
  label: '#000000',
  secondaryLabel: '#6c6c70', // systemGray's 60% label is only ~3.5:1 on white
  body: '#48484a', // longer secondary text (summaries)
  separator: 'rgba(60,60,67,0.29)',
  tint: '#0066d6', // system blue #007aff is ~4.0:1 on white
  destructive: '#d70015',
  goodText: '#248a3d', // green that's readable as text
  onPrimary: '#ffffff', // text on the primary (label-colored) button
  barFill: '#1c1c1e',
  // The score card floats over the photo.
  elevated: 'rgba(255,255,255,0.94)',
  elevatedEdge: 'rgba(255,255,255,0.9)',
  inset: 'rgba(255,255,255,0.7)', // panel inside the card
};

export type Palette = typeof light;

const dark: Palette = {
  background: '#000000',
  groupedBackground: '#000000',
  cell: '#1c1c1e',
  fill: 'rgba(120,120,128,0.32)',
  label: '#ffffff',
  secondaryLabel: '#a1a1a8', // ~7:1 on #1c1c1e
  body: '#d1d1d6',
  separator: 'rgba(84,84,88,0.65)',
  tint: '#409cff', // system blue's dark variant, readable on black
  destructive: '#ff6961',
  goodText: '#30d158',
  onPrimary: '#000000', // the primary button turns white in dark mode
  barFill: '#f2f2f7',
  elevated: 'rgba(44,44,46,0.96)',
  elevatedEdge: 'rgba(255,255,255,0.12)',
  inset: 'rgba(255,255,255,0.06)',
};

export const palettes = { light, dark };
export type ThemeMode = keyof typeof palettes;

export interface Theme {
  mode: ThemeMode;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<Theme>({ mode: 'light', colors: light, setMode: () => {} });
export const useTheme = () => useContext(ThemeContext);

// Styles that follow the theme: `const useStyles = themedStyles((colors) => ({ ... }))`, then
// `const styles = useStyles()` in each component. One StyleSheet per palette, built on first use.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];

export function themedStyles<T extends NamedStyles>(factory: (colors: Palette) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors)) as T;
      cache.set(colors, styles);
    }
    return styles;
  };
}

// Verdict fills and rings. Always paired with black text or a dark scrim, never used as text on white.
export const verdictColors = {
  good: '#34c759',
  caution: '#ffcc00',
  bad: '#ff3b30',
};

// Surfaces drawn over the camera stay dark, like Apple Camera, in both themes.
export const cameraColors = {
  surface: '#2c2c2e',
  label: '#ffffff',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  tint: '#409cff',
};
