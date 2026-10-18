import type { Config } from '../config/env.js';
import { createSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { createCheckoutStore } from './store.js';
import { createStripeGateway } from './stripe.js';
import { CheckoutService } from './service.js';

export function createCheckout(config: Config): CheckoutService | undefined {
  if (!config.stripeSecretKey || !config.stripePublishableKey || !config.stripeWebhookSecret
    || !config.supabaseServiceRoleKey) return undefined;
  return new CheckoutService(createCheckoutStore(createSupabaseAdmin(config)),
    createStripeGateway(config.stripeSecretKey, config.stripeWebhookSecret), config.stripePublishableKey);
}
