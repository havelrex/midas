import { useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LibraryItem, SubScores } from '../../shared/contracts';
import { removeItem, stopWatching } from '../features/library/api';
import { useItem } from '../features/library/hooks';
import { createDemoOffer, DEMO_TOOLS_ENABLED, dropDemoPrice } from '../lib/demoApi';
import { colors } from '../lib/theme';
import { formatPrice, VERDICT_DISPLAY, verdictReason } from '../lib/verdict';

interface Props {
  id: string;
  onBack: () => void; // back to the Library
  onCheckout: (item: LibraryItem) => void; // Pedro's checkout flow
}

// Pushed from a Library tile. Reads the saved row and stays live (e.g. watching -> purchased).
export default function ItemDetailScreen({ id, onBack, onCheckout }: Props) {
  const { item, loading, error, deleted, refresh } = useItem(id);

  let body: ReactNode;
  if (loading) {
    body = <ActivityIndicator style={styles.centered} color={colors.secondaryLabel} />;
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Couldn't load this item</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <Pressable onPress={refresh} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (deleted || !item) {
    // getItem returns null for a missing row, so "not found" and "deleted while open" look the same.
    body = (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>This item was deleted</Text>
        <Text style={styles.emptyBody}>It's no longer in your Library.</Text>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Back to Library</Text>
        </Pressable>
      </View>
    );
  } else {
    body = <ItemDetailView item={item} onCheckout={() => onCheckout(item)} onDeleted={onBack} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to Library"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <View style={styles.chevron} />
        <Text style={styles.backText}>Library</Text>
      </Pressable>
      {body}
    </SafeAreaView>
  );
}

const SUBSCORES: { key: keyof SubScores; label: string }[] = [
  { key: 'quality', label: 'Quality' },
  { key: 'price', label: 'Price' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'timing', label: 'Timing' },
];

// The detail content on its own, so the score card can show the same view for an unsaved snap
// (pass no onDeleted there: an unsaved snap has no row to delete).
export function ItemDetailView({
  item,
  onCheckout,
  onDeleted,
}: {
  item: LibraryItem;
  onCheckout: () => void;
  onDeleted?: () => void;
}) {
  const verdict = VERDICT_DISPLAY[item.verdict];
  const listing = item.best_listing;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Runs a DB action with one shared busy/error state for the footer and delete row.
  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError(failure);
    } finally {
      setBusy(false);
    }
  };

  // Hidden: long-press the verdict line (EXPO_PUBLIC_DEMO_TOOLS=true, saved items only).
  const openDemoTools = () => {
    Alert.alert('Demo tools', 'Sandbox store actions for this item.', [
      { text: 'Create sandbox offer', onPress: async () => Alert.alert('Demo', await createDemoOffer(item.id)) },
      { text: 'Drop the price', onPress: async () => Alert.alert('Demo', await dropDemoPrice(item.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmStopWatching = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Stop watching?',
        message: `We won't buy this at ${formatPrice(item.target_price ?? 0)}.`,
        options: ['Stop watching', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) run(() => stopWatching(item.id), "Couldn't stop watching. Try again.");
      },
    );
  };

  const confirmDelete = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Delete this item?',
        message:
          item.checkout_status === 'watching'
            ? "This also stops watching the price. This can't be undone."
            : "This can't be undone.",
        options: ['Delete', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index !== 0) return;
        run(async () => {
          await removeItem(item);
          onDeleted?.();
        }, "Couldn't delete this item. Try again.");
      },
    );
  };

  // No purchase-price column: an auto-buy paid target_price, a Buy now paid the best listing.
  const paid = item.target_price ?? listing.price + listing.shipping;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {/* Same photo + score badge as the Library tile, so it reads as the item you tapped. */}
          {item.thumbnail_url ? (
            <View accessible accessibilityLabel={`Score ${item.score} out of 100, ${verdict.label}`}>
              <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} />
              <View style={[styles.badge, { borderColor: verdict.color }]}>
                <Text style={styles.badgeText}>{item.score}</Text>
              </View>
            </View>
          ) : (
            <View
              accessible
              accessibilityLabel={`Score ${item.score} out of 100, ${verdict.label}`}
              style={[styles.ring, { borderColor: verdict.color }]}
            >
              <Text style={styles.ringScore}>{item.score}</Text>
            </View>
          )}
          <View style={styles.heroText}>
            {(item.brand || item.model) && (
              <Text style={styles.brand} numberOfLines={1}>
                {[item.brand, item.model].filter(Boolean).join(' · ')}
              </Text>
            )}
            <Text style={styles.name} accessibilityRole="header">
              {item.name}
            </Text>
            <View style={[styles.pill, { backgroundColor: verdict.color }]}>
              <Text style={styles.pillText}>{verdict.label}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.reason} onLongPress={DEMO_TOOLS_ENABLED && item.id ? openDemoTools : undefined}>
          {verdictReason(item.verdict, item.subscores)}
        </Text>
        {!!item.summary && <Text style={styles.summary}>{item.summary}</Text>}

        <Text style={styles.sectionHeader}>Why this score</Text>
        <View style={styles.group}>
          {SUBSCORES.map(({ key, label }, i) => {
            const sub = item.subscores[key];
            if (!sub) return null; // no usable data for this sub-score
            return (
              <View key={key} style={[styles.subRow, i > 0 && styles.subRowDivider]}>
                <View style={styles.subTop}>
                  <Text style={styles.subLabel}>{label}</Text>
                  <Text style={styles.subValue}>{sub.value}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, sub.value))}%` }]} />
                </View>
                <Text style={styles.subReason}>{sub.reason}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionHeader}>Best price</Text>
        <View style={styles.group}>
          <View style={styles.listingRow}>
            <View style={styles.listingText}>
              <Text style={styles.merchant} numberOfLines={1}>
                {listing.merchant}
              </Text>
              <Text style={styles.shipping}>
                {listing.shipping ? `${formatPrice(listing.shipping)} shipping` : 'Free shipping'}
              </Text>
            </View>
            <Text style={styles.price}>{formatPrice(listing.price)}</Text>
          </View>
          {!!listing.url && (
            <Pressable
              onPress={() => Linking.openURL(listing.url)}
              accessibilityRole="link"
              style={({ pressed }) => [styles.linkRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.linkText}>View listing</Text>
            </Pressable>
          )}
        </View>

        {onDeleted && (
          <View style={[styles.group, styles.deleteGroup]}>
            <Pressable
              onPress={confirmDelete}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.deleteRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.deleteText}>Delete from Library</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Pinned so the next step is always in thumb reach, whatever the scroll position. */}
      <View style={styles.footer}>
        {actionError && (
          <Text style={styles.actionError} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        )}
        {item.checkout_status === 'none' && (
          <Pressable
            onPress={onCheckout}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>Checkout · {formatPrice(listing.price + listing.shipping)}</Text>
          </Pressable>
        )}
        {item.checkout_status === 'watching' && (
          <View style={styles.status}>
            <View style={styles.statusText}>
              <Text style={styles.watchingTitle}>
                Watching for {formatPrice(item.target_price ?? 0)}
              </Text>
              <Text style={styles.statusBody}>We'll buy it with your Visa card when the price gets there.</Text>
            </View>
            <Pressable
              onPress={confirmStopWatching}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.stop, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={colors.tint} /> : <Text style={styles.stopText}>Stop</Text>}
            </Pressable>
          </View>
        )}
        {item.checkout_status === 'purchased' && (
          <View style={styles.status}>
            <Text style={styles.purchasedTitle}>Bought for {formatPrice(paid)} · Visa</Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.groupedBackground },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, alignSelf: 'flex-start' },
  // Drawn chevron, same as LibraryScreen's.
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
  pressed: { opacity: 0.5 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  thumb: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.fill },
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
  // Full ring rather than a progress arc: arcs need react-native-svg (native, Havel's call).
  ring: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 7,
    backgroundColor: colors.cell,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringScore: { color: colors.label, fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heroText: { flex: 1, alignItems: 'flex-start', gap: 4 },
  brand: { color: colors.secondaryLabel, fontSize: 13 },
  name: { color: colors.label, fontSize: 22, fontWeight: '700', lineHeight: 27 },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { color: '#000', fontSize: 13, fontWeight: '700' },
  reason: { color: colors.label, fontSize: 17, lineHeight: 23, marginTop: 20 },
  summary: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20, marginTop: 6 },

  sectionHeader: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: 'uppercase',
    marginTop: 28,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  group: { backgroundColor: colors.cell, borderRadius: 12, overflow: 'hidden' },
  rowPressed: { backgroundColor: colors.fill },

  subRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  subRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  subTop: { flexDirection: 'row', justifyContent: 'space-between' },
  subLabel: { color: colors.label, fontSize: 17 },
  subValue: { color: colors.secondaryLabel, fontSize: 17, fontVariant: ['tabular-nums'] },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: colors.fill },
  barFill: { height: 4, borderRadius: 2, backgroundColor: '#3a3a3c' },
  subReason: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },

  listingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 16 },
  listingText: { flex: 1, gap: 2 },
  merchant: { color: colors.label, fontSize: 17 },
  shipping: { color: colors.secondaryLabel, fontSize: 13 },
  price: { color: colors.label, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  linkRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  linkText: { color: colors.tint, fontSize: 17 },

  deleteGroup: { marginTop: 32 },
  deleteRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.destructive, fontSize: 17 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: colors.groupedBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  actionError: { color: colors.destructive, fontSize: 15, lineHeight: 20 },
  primary: { minHeight: 52, borderRadius: 14, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  primaryPressed: { opacity: 0.8 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.cell,
  },
  statusText: { flex: 1, gap: 2 },
  watchingTitle: { color: colors.tint, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statusBody: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  stop: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  stopText: { color: colors.tint, fontSize: 17 },
  purchasedTitle: { color: colors.goodText, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  retry: { marginTop: 4, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { color: colors.tint, fontSize: 17, fontWeight: '600' },
  emptyTitle: { color: colors.label, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.secondaryLabel, fontSize: 17, lineHeight: 22, textAlign: 'center' },
});
