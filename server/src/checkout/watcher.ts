import type { CheckoutService } from './service.js';

export function startCheckoutWatcher(service: Pick<CheckoutService, 'poll'>,
  logger: Pick<Console, 'info' | 'error'> = console, intervalMs = 10_000) {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = service.poll().then((result) => {
      if (result.errors) logger.error(JSON.stringify({ event: 'checkout_poll_errors', ...result }));
    }).catch(() => logger.error('checkout_poll_failed')).finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await inFlight; };
}
