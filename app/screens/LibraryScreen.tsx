import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { CheckoutStatus, LibraryItem } from '../../shared/contracts';
import { useLibrary } from '../features/library/hooks';
import { colors, verdictColors } from '../lib/theme';
import { formatPrice, VERDICT_DISPLAY } from '../lib/verdict';

interface Props {
  onBack: () => void; // back to the camera
  onOpenItem: (id: string) => void;
}

const GUTTER = 16;
const GAP = 12;

// Pending auto-buys first: they're the items that can still change.
const SECTIONS: { status: CheckoutStatus; title: string }[] = [
  { status: 'watching', title: 'Watching' },
  { status: 'none', title: 'Saved' },
  { status: 'purchased', title: 'Purchased' },
];

// Pushed from the camera's bottom-left button: back control, large title, Photos-style grid by status.
export default function LibraryScreen({ onBack, onOpenItem }: Props) {
  const { items, loading, error, refresh } = useLibrary();
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const tileWidth = (width - GUTTER * 2 - GAP) / 2;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const header = (
    <>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to camera"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <View style={styles.chevron} />
        <Text style={styles.backText}>Camera</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        Library
      </Text>
    </>
  );

  let body = null;
  if (loading) {
    body = <ActivityIndicator style={styles.centered} color={colors.secondaryLabel} />;
  } else if (error && items.length === 0) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Couldn't load your library</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <Pressable onPress={onRefresh} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Your library is empty</Text>
        <Text style={styles.emptyBody}>Nothing is saved yet. Snap a product, then swipe its score card left to save it here.</Text>
      </View>
    );
  }

  if (body) {
    return (
      <SafeAreaView style={styles.container}>
        {header}
        {body}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
      >
        {header}
        {SECTIONS.map(({ status, title }) => {
          const group = items.filter((i) => i.checkout_status === status);
          if (group.length === 0) return null;
          return (
            <View key={status} style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {title}
                <Text style={styles.sectionCount}>  {group.length}</Text>
              </Text>
              <View style={styles.grid}>
                {group.map((item) => (
                  <Tile key={item.id} item={item} width={tileWidth} onPress={() => onOpenItem(item.id)} />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ item, width, onPress }: { item: LibraryItem; width: number; onPress: () => void }) {
  const verdict = VERDICT_DISPLAY[item.verdict];
  const watchingFor =
    item.checkout_status === 'watching' && item.target_price != null ? `Buys at ${formatPrice(item.target_price)}` : null;
  const highlight = useRef(new Animated.Value(0)).current;
  const prevStatus = useRef(item.checkout_status);

  // An auto-buy lands via Realtime (watching -> purchased): flash a green ring so it's noticed.
  // Opacity only, so it stays a plain fade under Reduce Motion.
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = item.checkout_status;
    if (was === 'watching' && item.checkout_status === 'purchased') {
      Animated.sequence([
        Animated.timing(highlight, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(highlight, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    }
  }, [item.checkout_status, highlight]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${verdict.label}, score ${item.score}${watchingFor ? `, ${watchingFor}` : ''}`}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View>
        <Image source={{ uri: item.thumbnail_url }} style={[styles.photo, { width, height: width }]} />
        <View style={[styles.score, { borderColor: verdict.color }]}>
          <Text style={styles.scoreText}>{item.score}</Text>
        </View>
        <Animated.View pointerEvents="none" style={[styles.boughtRing, { opacity: highlight }]} />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={styles.meta}>
        <View style={[styles.pill, { backgroundColor: verdict.color }]}>
          <Text style={styles.pillText}>{verdict.label}</Text>
        </View>
        {watchingFor && <Text style={styles.watching}>{watchingFor}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: GUTTER, alignSelf: 'flex-start' },
  // Drawn chevron; swap for the SF Symbol "chevron.left" if expo-symbols is ever added.
  chevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: colors.tint,
    transform: [{ rotate: '45deg' }],
    marginRight: 6,
    marginLeft: 2,
  },
  backText: { color: colors.tint, fontSize: 17 },
  title: { color: colors.label, fontSize: 34, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: GUTTER, marginBottom: 8 },
  list: { paddingBottom: 48 },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.label, fontSize: 20, fontWeight: '600', paddingHorizontal: GUTTER, marginBottom: 12 },
  sectionCount: { color: colors.secondaryLabel, fontWeight: '400', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GUTTER, rowGap: 20 },
  photo: { borderRadius: 12, backgroundColor: colors.groupedBackground },
  // The score ring is the app's mark: same verdict color as the score card, smaller.
  score: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }, // on the dark scrim
  boughtRing: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12, borderWidth: 3, borderColor: verdictColors.good },
  name: { color: colors.label, fontSize: 15, fontWeight: '600', lineHeight: 20, marginTop: 8 },
  meta: { marginTop: 6, gap: 4, alignItems: 'flex-start' },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  pillText: { color: '#000', fontSize: 13, fontWeight: '700' },
  watching: { color: colors.tint, fontSize: 13, fontVariant: ['tabular-nums'] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  emptyTitle: { color: colors.label, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.secondaryLabel, fontSize: 17, lineHeight: 22, textAlign: 'center' },
  retry: { marginTop: 4, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { color: colors.tint, fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
