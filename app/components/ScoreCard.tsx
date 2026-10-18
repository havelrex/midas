import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { AnalysisOutput, ScoreOutput } from '../../shared/contracts';
import type { ScoreStatus } from '../features/library/useSaveSnap';
import { colors } from '../lib/theme';
import { formatPrice, VERDICT_DISPLAY, verdictReason } from '../lib/verdict';

interface Props {
  photoUri: string;
  analysis: AnalysisOutput;
  score: ScoreOutput | null;
  status: ScoreStatus;
  onSave: () => void; // swipe left, toward the Library button
  onDelete: () => void; // swipe right
  onOpen: () => void; // tap: full detail
  onRetry: () => void; // scoring failed
  onCheckout: () => void; // saves the item, then opens checkout
  checkingOut?: boolean; // the save behind Checkout is running
}

const COMMIT_DISTANCE = 120;
const COMMIT_VELOCITY = 0.8;

// What a released drag does. Only sideways drags count: left saves (toward the Library button),
// right deletes. Up and down scroll the card. Short, slow drags and saves that aren't allowed spring back.
export function swipeOutcome(
  g: { dx: number; dy: number; vx: number; vy: number },
  canSave: boolean,
): 'save' | 'delete' | 'cancel' {
  if (Math.abs(g.dx) < Math.abs(g.dy)) return 'cancel';
  if (Math.abs(g.dx) < COMMIT_DISTANCE && Math.abs(g.vx) < COMMIT_VELOCITY) return 'cancel';
  const save = g.dx < 0;
  if (save && !canSave) return 'cancel';
  return save ? 'save' : 'delete';
}

// A drag is a swipe only when it's clearly sideways; anything more vertical belongs to the scroll view.
const isSideways = (g: { dx: number; dy: number }) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;

// The card that appears after a snap. JS-only gestures (PanResponder + Animated), so no native build.
export default function ScoreCard({
  photoUri, analysis, score, status, onSave, onDelete, onOpen, onRetry, onCheckout, checkingOut = false,
}: Props) {
  const { width } = useWindowDimensions();
  const panX = useRef(new Animated.Value(0)).current;
  const canSave = status === 'ready' && !!score;
  const [open, setOpen] = useState(false); // "Show breakdown"

  // Handlers read the latest props through a ref; the responder itself is created once.
  const latest = useRef({ canSave, onSave, onDelete });
  latest.current = { canSave, onSave, onDelete };

  const responder = useMemo(() => {
    const springBack = () => Animated.spring(panX, { toValue: 0, friction: 6, useNativeDriver: false }).start();

    const flyOut = (x: number, done: () => void) =>
      Animated.timing(panX, { toValue: x, duration: 180, useNativeDriver: false }).start(done);

    return PanResponder.create({
      // Claim only sideways drags (capture phase, so it wins over the Pressable); vertical drags scroll.
      onMoveShouldSetPanResponderCapture: (_e, g) => isSideways(g),
      onPanResponderTerminationRequest: () => false, // keep the swipe once it has started
      onPanResponderMove: Animated.event([null, { dx: panX }], { useNativeDriver: false }),
      onPanResponderTerminate: springBack,
      onPanResponderRelease: (_e, g) => {
        const { canSave: allowed, onSave: saveCard, onDelete: deleteCard } = latest.current;
        const outcome = swipeOutcome(g, allowed);
        if (outcome === 'cancel') return springBack();
        flyOut((outcome === 'save' ? -1 : 1) * width * 1.5, outcome === 'save' ? saveCard : deleteCard);
      },
    });
  }, [panX, width]);

  const rotate = panX.interpolate({ inputRange: [-width, 0, width], outputRange: ['-12deg', '0deg', '12deg'] });
  const verdict = score ? VERDICT_DISPLAY[score.verdict] : null;
  const subtitle = [analysis.brand, analysis.model].filter(Boolean).join(' · ');

  return (
    <Animated.View style={[styles.card, { transform: [{ translateX: panX }, { rotate }] }]} {...responder.panHandlers}>
      {/* Scrolls when the card (e.g. with the breakdown open) is taller than the space on screen. */}
      <ScrollView style={styles.scroll} bounces={false} showsVerticalScrollIndicator>
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
          ...(canSave
            ? [
                { name: 'activate' },
                { name: 'breakdown', label: open ? 'Hide breakdown' : 'Show breakdown' },
                { name: 'save', label: 'Save to Library' },
              ]
            : []),
          { name: 'delete', label: 'Delete' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onOpen();
          if (e.nativeEvent.actionName === 'breakdown') setOpen((o) => !o);
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
            <Text style={styles.name}>{analysis.name}</Text>
            {verdict && (
              <View style={[styles.pill, { backgroundColor: verdict.color }]}>
                <Text style={styles.pillText}>{verdict.label}</Text>
              </View>
            )}
          </View>
        </View>

        {!!analysis.summary && <Text style={styles.summary}>{analysis.summary}</Text>}
        {!analysis.model && <Text style={styles.summary}>Exact model unknown. Retake with the model label visible.</Text>}

        {status === 'scoring' && (
          <View style={styles.row}>
            <ActivityIndicator color={colors.secondaryLabel} />
            <Text style={styles.secondary}>Scoring…</Text>
          </View>
        )}
        {status === 'ready' && score && <Text style={styles.reason}>{verdictReason(score.verdict, score.subscores)}</Text>}

        {canSave && score?.best_listing && (
          <Pressable
            onPress={onCheckout}
            disabled={checkingOut}
            accessibilityRole="button"
            accessibilityLabel={`Checkout, ${formatPrice(score.best_listing.price + score.best_listing.shipping)}`}
            accessibilityHint="Saves this item to your Library and opens checkout."
            accessibilityState={{ disabled: checkingOut, busy: checkingOut }}
            style={({ pressed }) => [styles.checkout, (pressed || checkingOut) && styles.checkoutPressed]}
          >
            {checkingOut ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.checkoutText}>
                Checkout · {formatPrice(score.best_listing.price + score.best_listing.shipping)}
              </Text>
            )}
          </Pressable>
        )}

        {status === 'ready' && score && (
          <Pressable
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Text style={styles.toggleText}>{open ? 'Hide breakdown' : 'Show breakdown'}</Text>
            <View style={[styles.chevron, open && styles.chevronOpen]} />
          </Pressable>
        )}
        {open && score && (
          <View style={styles.breakdown}>
            {SUBSCORES.map(({ key, label }) => {
              const sub = score.subscores[key];
              if (!sub) return null; // no usable data for this sub-score
              return (
                <View key={key} style={styles.sub}>
                  {/* Name and score share one line and never wrap; the bar and full reason sit below. */}
                  <View style={styles.subTop}>
                    <Text style={styles.subLabel} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={styles.subValue} numberOfLines={1}>
                      {sub.value}
                    </Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, sub.value))}%` }]} />
                  </View>
                  <Text style={styles.subReason}>{sub.reason}</Text>
                </View>
              );
            })}
            {score.best_listing && (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel} numberOfLines={1}>
                  Best price · {score.best_listing.merchant}
                </Text>
                <Text style={styles.priceValue}>{formatPrice(score.best_listing.price + score.best_listing.shipping)}</Text>
              </View>
            )}
          </View>
        )}
        {status === 'no_listing' && (
          <Text style={styles.secondary}>Couldn't find this for sale, so it can't be saved. Swipe right to delete.</Text>
        )}
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

        <Text style={styles.hint}>{canSave ? 'Tap for full details  ·  ← Save  ·  Delete →' : 'Delete →'}</Text>
      </Pressable>
      </ScrollView>
    </Animated.View>
  );
}

// Light "glass" look. A real backdrop blur needs a native package (expo-blur / expo-glass-effect),
// which needs a new build; until then it's a near-opaque white panel with a bright edge and soft shadow.
const styles = StyleSheet.create({
  card: {
    width: '90%',
    maxWidth: 420,
    maxHeight: '96%', // of the photo area; the ScrollView inside takes over past this
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
  },
  // Shrinks to the card's max height so it can scroll; clips to the card's corners here, not on the
  // card itself, because overflow: hidden on the card would remove its shadow on iOS.
  scroll: { flexGrow: 0, flexShrink: 1, borderRadius: 34, overflow: 'hidden' },
  body: { padding: 18, gap: 12 },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  photo: { width: 92, height: 92, borderRadius: 22, backgroundColor: colors.groupedBackground },
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
  subtitle: { color: colors.secondaryLabel, fontSize: 13 },
  name: { color: colors.label, fontSize: 20, fontWeight: '700', lineHeight: 24 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 2 },
  pillText: { color: '#000', fontSize: 13, fontWeight: '700' },
  summary: { color: '#48484a', fontSize: 15, lineHeight: 20 },
  reason: { color: colors.label, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  secondary: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },
  retry: { color: colors.tint, fontSize: 15, fontWeight: '600' },
  // Same primary button as the item detail screen's Checkout.
  checkout: { minHeight: 50, borderRadius: 25, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  checkoutPressed: { opacity: 0.8 },
  checkoutText: { color: '#fff', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // Glass capsule
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    backgroundColor: colors.fill,
  },
  toggleText: { color: colors.label, fontSize: 15, fontWeight: '600' },
  // Drawn chevron (no icon package); points down, flips up when open.
  chevron: {
    width: 8,
    height: 8,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: colors.label,
    transform: [{ rotate: '45deg' }],
    marginTop: -4,
  },
  chevronOpen: { transform: [{ rotate: '-135deg' }], marginTop: 4 },
  breakdown: {
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.08)',
  },
  sub: { gap: 6 },
  subTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  subLabel: { flexShrink: 1, color: colors.label, fontSize: 15, fontWeight: '600' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: '#1c1c1e' },
  subValue: { color: colors.label, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subReason: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  priceLabel: { flexShrink: 1, color: colors.secondaryLabel, fontSize: 15 },
  priceValue: { color: colors.label, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { color: colors.secondaryLabel, fontSize: 13, textAlign: 'center' },
});

const SUBSCORES = [
  { key: 'quality', label: 'Quality' },
  { key: 'price', label: 'Price' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'timing', label: 'Timing' },
] as const;
