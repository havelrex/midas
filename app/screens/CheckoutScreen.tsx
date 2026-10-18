import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { randomUUID } from 'expo-crypto';
import type { ItemCheckout, PaymentSheetConfig, OrderSummary } from '../../shared/checkout';
import { useItem } from '../features/library/hooks';
import { apiFetch } from '../lib/apiFetch';
import { colors } from '../lib/theme';
import { formatPrice } from '../lib/verdict';

type Config = { sandbox: boolean; currency: string; consentVersion: 'sandbox-autobuy-v1'; consentText: string };
type Notice = { text: string; error: boolean } | null;
const money = (cents: number) => formatPrice(cents / 100);

interface Props {
  itemId: string;
  onBack: () => void;
  backLabel?: string; // where Back goes: "Camera" or "Item"
}

// Only demo items can be bought: the server says `eligible` when it holds a sandbox offer for the item.
// Everything else shows its price with Buy disabled. Test mode only; Stripe test keys are enforced below.
export default function CheckoutScreen({ itemId, onBack, backLabel = 'Back' }: Props) {
  const { item } = useItem(itemId);
  const [state, setState] = useState<ItemCheckout | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [threshold, setThreshold] = useState('');
  const [consent, setConsent] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const buyRequest = useRef<{ id: string; revision: number } | null>(null);
  const setupRequest = useRef<string | null>(null);
  const setupId = useRef<string | null>(null);
  const path = `/checkout/items/${encodeURIComponent(itemId)}`;
  const say = (text: string, error = false) => { if (mounted.current) setNotice({ text, error }); };

  const refresh = useCallback(async () => {
    const [settings, current] = await Promise.all([
      apiFetch<Config>('/checkout/config'), apiFetch<ItemCheckout>(path),
    ]);
    if (!settings.sandbox || settings.currency !== 'usd' || settings.consentVersion !== 'sandbox-autobuy-v1') throw new Error('Unsupported test configuration');
    if (mounted.current) { setConfig(settings); setState(current); }
  }, [path]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(null);
    try { await action(); }
    catch (e) {
      console.warn('checkout failed:', e instanceof Error ? e.message : e);
      say("Couldn't complete checkout. Pull down to refresh, then try again.", true);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void run(refresh);
    return () => { mounted.current = false; };
  }, [refresh]);

  const onPullRefresh = async () => {
    setRefreshing(true);
    await run(refresh);
    if (mounted.current) setRefreshing(false);
  };

  async function showSheet(sheet: PaymentSheetConfig): Promise<boolean> {
    if (!sheet.publishableKey.startsWith('pk_test_') ||
      (!sheet.paymentIntentClientSecret && !sheet.setupIntentClientSecret)) throw new Error('Test configuration required');
    await initStripe({ publishableKey: sheet.publishableKey });
    const initialized = await initPaymentSheet({
      merchantDisplayName: sheet.merchantDisplayName,
      customerId: sheet.customerId, customerSessionClientSecret: sheet.customerSessionClientSecret,
      ...(sheet.paymentIntentClientSecret ? { paymentIntentClientSecret: sheet.paymentIntentClientSecret }
        : { setupIntentClientSecret: sheet.setupIntentClientSecret! }),
      allowsDelayedPaymentMethods: false,
    });
    if (initialized.error) throw new Error('Payment sheet initialization failed');
    const result = await presentPaymentSheet();
    if (result.error) {
      if (result.error.code === 'Canceled') { say('Payment canceled.'); return false; }
      throw new Error('Payment sheet failed');
    }
    return true;
  }
  async function buyNow() {
    if (!state?.quote) return;
    const revision = state.quote.revision;
    if (!buyRequest.current || buyRequest.current.revision !== revision) buyRequest.current = { id: randomUUID(), revision };
    const sheet = await apiFetch<PaymentSheetConfig>(`${path}/payment-intent`, {
      method: 'POST', body: JSON.stringify({ requestId: buyRequest.current.id, offerRevision: revision }),
    });
    try {
      if (await showSheet(sheet) && sheet.order) {
        const order = await apiFetch<OrderSummary>(`/checkout/orders/${sheet.order.id}`);
        say(order.status === 'succeeded' ? 'Purchased. It moves to Purchased in your Library.' : 'Payment is still processing. Pull down to refresh.');
      }
    } finally { await refresh(); }
  }
  async function watch() {
    if (!config || !consent || !/^\d+(\.\d{1,2})?$/.test(threshold)) { say('Enter a target like 299.99 and turn on the authorization.', true); return; }
    const cents = Math.round(Number(threshold) * 100);
    if (!Number.isSafeInteger(cents) || cents < 50 || cents > 99999999) { say('Target must be between $0.50 and $999,999.99.', true); return; }
    if (!setupId.current) {
      setupRequest.current ??= randomUUID();
      const sheet = await apiFetch<PaymentSheetConfig>('/checkout/setup-intent', {
        method: 'POST', body: JSON.stringify({ requestId: setupRequest.current, consentVersion: config.consentVersion }),
      });
      if (!await showSheet(sheet)) return;
      if (!sheet.setupIntentId) throw new Error('Missing setup intent');
      setupId.current = sheet.setupIntentId;
    }
    await apiFetch(`${path}/autobuy`, { method: 'PUT', body: JSON.stringify({
      setupIntentId: setupId.current, thresholdCents: cents, consentVersion: config.consentVersion,
    }) });
    setupId.current = null; setupRequest.current = null; setConsent(false); setThreshold('');
    say("Watching. We'll buy it when the total drops to your target.");
    await refresh();
  }

  const order = state?.order;
  const pending = !!order && !['succeeded', 'canceled'].includes(order.status);
  const purchased = order?.status === 'succeeded';
  const watching = !!state?.watch && ['active', 'charging', 'paused'].includes(state.watch.state);
  const canBuy = !!state?.eligible && !!config && !pending && !watching && !purchased;
  const quote = state?.quote;
  const listing = item?.best_listing;
  const loaded = state !== null;

  return (
    <SafeAreaView style={styles.container}>
      <Pressable
        onPress={onBack}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backLabel}`}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <View style={styles.chevron} />
        <Text style={styles.backText}>{backLabel}</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={colors.secondaryLabel} />}
      >
        <Text style={styles.title} accessibilityRole="header">Checkout</Text>

        <View style={[styles.group, styles.itemRow]}>
          {item?.thumbnail_url ? (
            <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]} />
          )}
          <View style={styles.itemText}>
            <Text style={styles.itemName} numberOfLines={2}>{quote?.title ?? item?.name ?? ' '}</Text>
            <Text style={styles.secondary} numberOfLines={1}>
              {quote ? quote.merchant : listing ? `Best price at ${listing.merchant}` : ' '}
            </Text>
          </View>
        </View>

        {!loaded && <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />}

        {quote && (
          <View style={[styles.group, styles.section]}>
            <Row label="Item" value={money(quote.priceCents)} />
            <Row label="Shipping" value={quote.shippingCents ? money(quote.shippingCents) : 'Free'} divider />
            <Row label="Total" value={money(quote.totalCents)} divider bold />
          </View>
        )}

        {loaded && !state.eligible && (
          <View style={[styles.group, styles.section, styles.note]}>
            <Text style={styles.noteTitle}>Not available to buy</Text>
            <Text style={styles.secondary}>
              Checkout only works for demo items.
              {listing ? ` The best price we found is ${formatPrice(listing.price + listing.shipping)} at ${listing.merchant}.` : ''}
            </Text>
          </View>
        )}

        {order && (purchased || pending) && (
          <View style={[styles.group, styles.section]}>
            {purchased ? (
              <Row label="Purchased" value={money(order.paidAmountCents ?? order.amountCents)} good />
            ) : (
              <>
                <Row label="Payment pending" value={money(order.amountCents)} />
                <View style={[styles.actions, styles.divider]}>
                  <TextButton label="Resume payment" disabled={busy} onPress={() => void run(async () => {
                    const sheet = await apiFetch<PaymentSheetConfig>(`/checkout/orders/${order.id}/resume`, { method: 'POST' });
                    try { await showSheet(sheet); } finally { await refresh(); }
                  })} />
                  <TextButton label="Cancel" destructive disabled={busy} onPress={() => void run(async () => {
                    await apiFetch(`/checkout/orders/${order.id}/cancel`, { method: 'POST' }); buyRequest.current = null; await refresh();
                  })} />
                </View>
              </>
            )}
          </View>
        )}

        {state?.eligible && !purchased && (
          <>
            <Text style={styles.sectionHeader}>Buy at a target price</Text>
            <View style={styles.group}>
              {watching && state.watch ? (
                <View style={styles.watchRow}>
                  <Text style={styles.watchText}>Watching for {money(state.watch.thresholdCents)}</Text>
                  <TextButton label="Stop" destructive disabled={busy} onPress={() => void run(async () => {
                    await apiFetch(`${path}/autobuy`, { method: 'DELETE' }); await refresh();
                  })} />
                </View>
              ) : (
                <>
                  <View style={styles.inputRow}>
                    <Text style={styles.rowLabel}>Target total</Text>
                    <Text style={styles.dollar}>$</Text>
                    <TextInput
                      accessibilityLabel="Target total in dollars, including shipping"
                      placeholder="0.00"
                      placeholderTextColor={colors.secondaryLabel}
                      keyboardType="decimal-pad"
                      value={threshold}
                      editable={!busy}
                      onChangeText={setThreshold}
                      style={styles.input}
                    />
                  </View>
                  <View style={[styles.switchRow, styles.divider]}>
                    <Text style={[styles.rowLabel, styles.flex]}>Authorize auto-buy</Text>
                    <Switch accessibilityLabel="Authorize auto-buy" value={consent} disabled={busy} onValueChange={setConsent} />
                  </View>
                  <View style={[styles.actions, styles.divider]}>
                    <TextButton label="Save card and watch" disabled={busy || !canBuy || !consent} onPress={() => void run(watch)} />
                  </View>
                </>
              )}
            </View>
            {!watching && config && <Text style={styles.footnote}>{config.consentText}</Text>}
          </>
        )}

        <Text style={styles.testMode}>Test mode. No real money is charged.</Text>
      </ScrollView>

      <View style={styles.footer}>
        {notice && (
          <Text accessibilityRole="alert" style={notice.error ? styles.error : styles.info}>{notice.text}</Text>
        )}
        <Pressable
          onPress={() => void run(buyNow)}
          disabled={busy || !canBuy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !canBuy, busy }}
          style={({ pressed }) => [styles.primary, (busy || !canBuy) && styles.disabled, pressed && styles.primaryPressed]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.primaryText}>
              {/* A disabled button always says why. */}
              {purchased ? 'Purchased'
                : watching && state?.watch ? `Watching for ${money(state.watch.thresholdCents)}`
                : loaded && !state.eligible ? 'Not available'
                : quote ? `Buy now · ${money(quote.totalCents)}` : 'Buy now'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, divider, bold, good }: { label: string; value: string; divider?: boolean; bold?: boolean; good?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <Text style={[styles.rowLabel, bold && styles.bold, good && styles.good]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold, good && styles.good]}>{value}</Text>
    </View>
  );
}

function TextButton({ label, onPress, disabled, destructive }: { label: string; onPress: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} hitSlop={8}
      style={({ pressed }) => [styles.textButton, (disabled || pressed) && styles.pressed]}>
      <Text style={[styles.textButtonText, destructive && styles.destructive]}>{label}</Text>
    </Pressable>
  );
}

// Same grouped look as the item detail screen.
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
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { color: colors.label, fontSize: 34, fontWeight: '700', letterSpacing: 0.4, marginBottom: 16 },
  loading: { marginTop: 24 },

  group: { backgroundColor: colors.cell, borderRadius: 12, overflow: 'hidden' },
  section: { marginTop: 20 },
  sectionHeader: { color: colors.secondaryLabel, fontSize: 13, textTransform: 'uppercase', marginTop: 28, marginBottom: 6, paddingHorizontal: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  flex: { flex: 1 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  thumbEmpty: { backgroundColor: colors.groupedBackground },
  itemText: { flex: 1, gap: 2 },
  itemName: { color: colors.label, fontSize: 17, fontWeight: '600', lineHeight: 22 },
  secondary: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 },
  rowLabel: { color: colors.label, fontSize: 17 },
  rowValue: { color: colors.label, fontSize: 17, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  good: { color: colors.goodText, fontWeight: '600' },

  note: { padding: 16, gap: 4 },
  noteTitle: { color: colors.label, fontSize: 17, fontWeight: '600' },

  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: 16 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  textButtonText: { color: colors.tint, fontSize: 17 },
  destructive: { color: colors.destructive },

  watchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52, paddingHorizontal: 16 },
  watchText: { color: colors.tint, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  inputRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16 },
  dollar: { color: colors.label, fontSize: 17, marginLeft: 'auto' },
  input: { minWidth: 90, color: colors.label, fontSize: 17, textAlign: 'right', paddingVertical: 10, fontVariant: ['tabular-nums'] },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16 },
  footnote: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18, marginTop: 8, paddingHorizontal: 16 },
  testMode: { color: colors.secondaryLabel, fontSize: 13, textAlign: 'center', marginTop: 28 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: colors.groupedBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  info: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 20 },
  error: { color: colors.destructive, fontSize: 15, lineHeight: 20 },
  primary: { minHeight: 52, borderRadius: 14, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  primaryPressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
