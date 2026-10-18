import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

interface Props {
  message: string; // e.g. "Saved to Library", "Deleted"
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
}

// Snackbar shown after a score-card swipe. Place it just above the shutter row so it's in
// thumb reach, and give it a fresh `key` per swipe so the timer restarts.
// Undo of a save: removeItem() from features/library/api. Undo of a delete: restore the card from memory.
export default function UndoBar({ message, onUndo, onExpire, durationMs = 5000 }: Props) {
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${message}. Undo available.`);
    const timer = setTimeout(() => expire.current(), durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs]);

  return (
    <View style={styles.bar} accessibilityLiveRegion="polite">
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
      >
        <Text style={styles.undoText}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
  },
  message: { color: colors.label, fontSize: 15, flexShrink: 1 },
  undo: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  pressed: { opacity: 0.5 },
  undoText: { color: colors.tintOnFill, fontSize: 17, fontWeight: '600' },
});
