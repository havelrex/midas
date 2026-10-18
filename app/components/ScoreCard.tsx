import { useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { AnalysisOutput, ScoreOutput } from '../../shared/contracts';
import type { ScoreStatus } from '../features/library/useSaveSnap';
import { cameraColors } from '../lib/theme';
import { VERDICT_DISPLAY, verdictReason } from '../lib/verdict';

interface Props {
  photoUri: string;
  analysis: AnalysisOutput;
  score: ScoreOutput | null;
  status: ScoreStatus;
  onSave: () => void; // swipe left/down, toward the Library button
  onDelete: () => void; // swipe right/up
  onOpen: () => void; // tap: full detail
  onRetry: () => void; // scoring failed
}

const COMMIT_DISTANCE = 120;
const COMMIT_VELOCITY = 0.8;

// The card that appears after a snap. JS-only gestures (PanResponder + Animated), so no native build.
export default function ScoreCard({ photoUri, analysis, score, status, onSave, onDelete, onOpen, onRetry }: Props) {
  const { width, height } = useWindowDimensions();
  const pan = useRef(new Animated.ValueXY()).current;
  const canSave = status === 'ready' && !!score;

  // Handlers read the latest props through a ref; the responder itself is created once.
  const latest = useRef({ canSave, onSave, onDelete });
  latest.current = { canSave, onSave, onDelete };

  const responder = useMemo(() => {
    const springBack = () =>
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: false }).start();

    const flyOut = (x: number, y: number, done: () => void) =>
      Animated.timing(pan, { toValue: { x, y }, duration: 180, useNativeDriver: false }).start(done);

    return PanResponder.create({
      // Claim only real drags (capture phase, so it wins over the Pressable); a tap still opens the card.
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderTerminate: springBack,
      onPanResponderRelease: (_e, g) => {
        const horizontal = Math.abs(g.dx) >= Math.abs(g.dy);
        const distance = horizontal ? g.dx : g.dy;
        const velocity = horizontal ? g.vx : g.vy;
        if (Math.abs(distance) < COMMIT_DISTANCE && Math.abs(velocity) < COMMIT_VELOCITY) return springBack();

        // Left or down saves (toward the Library button); right or up deletes.
        const save = horizontal ? distance < 0 : distance > 0;
        const { canSave: allowed, onSave: saveCard, onDelete: deleteCard } = latest.current;
        if (save && !allowed) return springBack();

        const sign = Math.sign(distance) || 1;
        flyOut(horizontal ? sign * width * 1.5 : 0, horizontal ? g.dy : sign * height, save ? saveCard : deleteCard);
      },
    });
  }, [pan, width, height]);

  const rotate = pan.x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-12deg', '0deg', '12deg'] });
  const verdict = score ? VERDICT_DISPLAY[score.verdict] : null;
  const subtitle = [analysis.brand, analysis.model].filter(Boolean).join(' · ');

  return (
    <Animated.View
      style={[styles.card, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}
      {...responder.panHandlers}
    >
      <Pressable
        onPress={canSave ? onOpen : undefined}
        accessibilityRole="button"
        accessibilityLabel={
          score && verdict
            ? `${analysis.name}, score ${Math.round(score.score)} out of 100, ${verdict.label}`
            : analysis.name
        }
        accessibilityHint={canSave ? 'Opens details. Swipe left to save, right to delete.' : undefined}
        // Swipes aren't reachable with VoiceOver, so expose them as actions.
        accessibilityActions={[
          ...(canSave ? [{ name: 'activate' }, { name: 'save', label: 'Save to Library' }] : []),
          { name: 'delete', label: 'Delete' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onOpen();
          if (e.nativeEvent.actionName === 'save') onSave();
          if (e.nativeEvent.actionName === 'delete') onDelete();
        }}
        style={({ pressed }) => [styles.body, pressed && canSave && styles.pressed]}
      >
        <View style={styles.header}>
          <View>
            <Image source={{ uri: photoUri }} style={styles.photo} />
            {score && verdict && (
              <View style={[styles.badge, { borderColor: verdict.color }]}>
                <Text style={styles.badgeText}>{Math.round(score.score)}</Text>
              </View>
            )}
          </View>
          <View style={styles.titles}>
            {!!subtitle && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
            <Text style={styles.name} numberOfLines={2}>
              {analysis.name}
            </Text>
            {verdict && (
              <View style={[styles.pill, { backgroundColor: verdict.color }]}>
                <Text style={styles.pillText}>{verdict.label}</Text>
              </View>
            )}
          </View>
        </View>

        {status === 'scoring' && (
          <View style={styles.row}>
            <ActivityIndicator color={cameraColors.label} />
            <Text style={styles.secondary}>Scoring…</Text>
          </View>
        )}
        {status === 'ready' && score && <Text style={styles.reason}>{verdictReason(score.verdict, score.subscores)}</Text>}
        {status === 'unavailable' && (
          <Text style={styles.secondary}>Scoring isn't available yet, so this can't be saved. Swipe right to delete.</Text>
        )}
        {status === 'error' && (
          <View style={styles.row}>
            <Text style={[styles.secondary, styles.flex]}>Couldn't score this item.</Text>
            <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.hint}>{canSave ? '← Save   ·   Delete →' : 'Delete →'}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '88%',
    maxWidth: 420,
    backgroundColor: cameraColors.surface, // over the photo, so it stays dark like Apple Camera
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  body: { padding: 16, gap: 12 },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  photo: { width: 96, height: 96, borderRadius: 12, backgroundColor: '#000' },
  // Same score ring as the Library tile and the detail header.
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  titles: { flex: 1, gap: 4, alignItems: 'flex-start' },
  subtitle: { color: cameraColors.secondaryLabel, fontSize: 13 },
  name: { color: cameraColors.label, fontSize: 20, fontWeight: '700', lineHeight: 24 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, marginTop: 2 },
  pillText: { color: '#000', fontSize: 13, fontWeight: '700' },
  reason: { color: cameraColors.label, fontSize: 15, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  secondary: { color: cameraColors.secondaryLabel, fontSize: 15, lineHeight: 20 },
  retry: { color: cameraColors.tint, fontSize: 15, fontWeight: '600' },
  hint: { color: cameraColors.secondaryLabel, fontSize: 13, textAlign: 'center' },
});
