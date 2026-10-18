import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { palettes, ThemeContext, type ThemeMode } from './theme';

const KEY = 'midas.theme';

// Holds the Light/Dark choice from Profile and remembers it on this phone.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => { if (saved === 'dark' || saved === 'light') setModeState(saved); })
      .catch(() => {}); // unreadable storage just means the default theme
  }, []);

  const value = useMemo(() => ({
    mode,
    colors: palettes[mode],
    setMode: (next: ThemeMode) => {
      setModeState(next);
      AsyncStorage.setItem(KEY, next).catch(() => {});
    },
  }), [mode]);

  return (
    <ThemeContext.Provider value={value}>
      {/* The camera sets its own light status bar while it's showing. */}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}
