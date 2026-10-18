import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput } from 'react-native';
import { initStripe, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { randomUUID } from 'expo-crypto';
import type { ItemCheckout, PaymentSheetConfig, OrderSummary } from '../../shared/checkout';
import { ApiError, apiFetch } from '../lib/apiFetch';
import { colors } from '../lib/theme';

type Config = { sandbox: boolean; currency: string; consentVersion: 'sandbox-autobuy-v1'; consentText: string };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CheckoutScreen({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const [state, setState] = useState<ItemCheckout | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [threshold, setThreshold] = useState('');
  const [consent, setConsent] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const buyRequest = useRef<{ id: string; revision: number } | null>(null);
  const setupRequest = useRef<string | null>(null);
  const setupId = useRef<string | null>(null);
  const path = `/checkout/items/${encodeURIComponent(itemId)}`;

  const refresh = useCallback(async () => {
    const [settings, current] = await Promise.all([
      apiFetch<Config>('/checkout/config'), apiFetch<ItemCheckout>(path),
    ]);
    if (!settings.sandbox || settings.currency !== 'usd' || settings.consentVersion !== 'sandbox-autobuy-v1') throw new Error('Unsupported test configuration');
    if (mounted.current) { setConfig(settings); setState(current); }
  }, [path]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try { await action(); }
    catch (e) {
      if (mounted.current) setMessage(e instanceof ApiError
        ? `Checkout request failed (${e.status}). Refresh the quote and check the test backend configuration.`
        : 'Checkout could not complete. Refresh status before retrying.');
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void run(refresh);
    return () => { mounted.current = false; };
  }, [refresh]);

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
      if (result.error.code === 'Canceled') { setMessage('Sheet closed. Resume or cancel any pending order below.'); return false; }
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
        setMessage(order.status === 'succeeded' ? 'Test purchase confirmed by the server.' : 'Confirmation pending. Refresh status; do not start another payment.');
      }
    } finally { await refresh(); }
  }
  async function watch() {
    if (!config || !consent || !/^\d+(\.\d{1,2})?$/.test(threshold)) { setMessage('Enter a USD target with at most two decimals and accept the authorization.'); return; }
    const cents = Math.round(Number(threshold) * 100);
    if (!Number.isSafeInteger(cents) || cents < 50 || cents > 99999999) { setMessage('Target must be between $0.50 and $999,999.99.'); return; }
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
    setupId.current = null; setupRequest.current = null; setConsent(false);
    setMessage('Test auto-buy authorized. A qualifying offer may charge immediately.');
    await refresh();
  }
  const order = state?.order;
  const pending = order && !['succeeded', 'canceled'].includes(order.status);
  const watching = state?.watch && ['active', 'charging', 'paused'].includes(state.watch.state);
  const canBuy = !!state?.eligible && !!config && !pending && !watching && order?.status !== 'succeeded';
  const button = (label: string, action: () => Promise<void>, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled}
      style={[styles.button, (busy || disabled) && styles.disabled]} onPress={() => void run(action)}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onBack}><Text style={styles.link}>Back to item</Text></Pressable>
    <Text style={styles.title}>Sandbox checkout</Text><Text>Test cards only. No real merchandise or fulfillment.</Text>
    <Text selectable>Item ID: {itemId}</Text>
    {busy && <ActivityIndicator />}{!!message && <Text accessibilityRole="alert">{message}</Text>}
    {state?.quote && <>
      <Text style={styles.title}>{state.quote.merchant}</Text><Text>{state.quote.title}</Text>
      <Text>Item {money(state.quote.priceCents)} + shipping {money(state.quote.shippingCents)}</Text>
      <Text>Total: {money(state.quote.totalCents)} USD</Text>
    </>}
    {state && !state.eligible && <Text>No sandbox offer is registered. Pedro must register this item ID with checkout:demo offer. Real retailer listings cannot be charged.</Text>}
    {order && <Text>Server order: {order.status}{order.paidAmountCents !== null ? ` - Paid ${money(order.paidAmountCents)}` : ''}</Text>}
    {state?.watch && <Text>Auto-buy: {state.watch.state} - Target including shipping: {money(state.watch.thresholdCents)}</Text>}
    {button('Refresh server status', refresh)}
    {button('Buy now (test)', buyNow, !canBuy)}
    {pending && order && <>
      {button('Resume existing payment', async () => {
        const sheet = await apiFetch<PaymentSheetConfig>(`/checkout/orders/${order.id}/resume`, { method: 'POST' });
        try { await showSheet(sheet); } finally { await refresh(); }
      })}
      {button('Cancel pending payment', async () => {
        await apiFetch(`/checkout/orders/${order.id}/cancel`, { method: 'POST' }); buyRequest.current = null; await refresh();
      })}
    </>}
    <Text style={styles.title}>Buy at target (test)</Text>
    <TextInput accessibilityLabel="Target total in USD" placeholder="Target total in USD" keyboardType="decimal-pad"
      value={threshold} editable={!busy} onChangeText={setThreshold} style={styles.input} />
    {config && <Text>{config.consentText}</Text>}
    <Text>The target includes shipping. A qualifying offer may charge immediately.</Text>
    <Switch accessibilityLabel="Agree to sandbox auto-buy authorization" value={consent} disabled={busy} onValueChange={setConsent} />
    {button('Save test card and authorize target', watch, !canBuy || !consent)}
    {!!watching && button('Cancel auto-buy authorization', async () => {
      await apiFetch(`${path}/autobuy`, { method: 'DELETE' }); await refresh();
    })}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' }, link: { color: colors.tint, fontSize: 17 },
  input: { borderWidth: 1, borderColor: colors.separator, padding: 14, borderRadius: 10 },
  button: { backgroundColor: colors.tint, padding: 14, borderRadius: 10 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' }, disabled: { opacity: 0.4 },
});
