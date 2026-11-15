import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { checkoutPayload } from '@eduerp/shared';
import { config } from '../../config';

/**
 * Payment gateway adapter (DEC-09 / CD-28). Razorpay first; others can implement the same interface.
 * Signatures are HMAC-SHA256 hex and are always compared in constant time.
 */
export interface GatewayPayment { id: string; orderId: string; amountPaise: number; status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'; method: string | null; error: string | null }

export interface PaymentGateway {
  readonly mode: 'razorpay' | 'simulated' | 'off';
  readonly keyId: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<{ id: string; amountPaise: number }>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  capture(paymentId: string, amountPaise: number): Promise<GatewayPayment>;
  refund(paymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ id: string; status: string }>;
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhook(rawBody: Buffer | string, signature: string): boolean;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

export function hmac(secret: string, payload: Buffer | string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

class GatewayError extends Error {}

/** Razorpay REST API (https://api.razorpay.com/v1) with basic auth (key id + key secret). */
export class RazorpayGateway implements PaymentGateway {
  readonly mode = 'razorpay' as const;
  constructor(readonly keyId: string, private readonly keySecret: string, private readonly webhookSecret: string) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
    if (!res.ok) throw new GatewayError(json.error?.description ?? `Razorpay ${res.status}`);
    return json;
  }
  private static payment(p: { id: string; order_id: string; amount: number; status: GatewayPayment['status']; method?: string; error_description?: string | null }): GatewayPayment {
    return { id: p.id, orderId: p.order_id, amountPaise: p.amount, status: p.status, method: p.method ?? null, error: p.error_description ?? null };
  }

  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    const o = await this.call<{ id: string; amount: number }>('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes, payment_capture: 1 });
    return { id: o.id, amountPaise: o.amount };
  }
  async fetchPayment(id: string) {
    return RazorpayGateway.payment(await this.call('GET', `/payments/${encodeURIComponent(id)}`));
  }
  async fetchOrderPayments(orderId: string) {
    const r = await this.call<{ items: Parameters<typeof RazorpayGateway.payment>[0][] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return r.items.map(RazorpayGateway.payment);
  }
  async capture(id: string, amountPaise: number) {
    return RazorpayGateway.payment(await this.call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: amountPaise, currency: 'INR' }));
  }
  async refund(paymentId: string, amountPaise: number, notes: Record<string, string>) {
    const r = await this.call<{ id: string; status: string }>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, notes });
    return { id: r.id, status: r.status };
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return safeEqual(hmac(this.keySecret, checkoutPayload(orderId, paymentId)), signature);
  }
  verifyWebhook(rawBody: Buffer | string, signature: string) {
    return safeEqual(hmac(this.webhookSecret, rawBody), signature);
  }
}

/**
 * Simulated gateway: no money moves. For development without keys and for automated tests. Uses the
 * same signature scheme with local secrets, so verification code is exercised for real. Never used
 * in production (the factory refuses it).
 */
export class SimulatedGateway implements PaymentGateway {
  readonly mode = 'simulated' as const;
  readonly keyId = 'rzp_simulated';
  static readonly KEY_SECRET = 'simulated-key-secret-not-a-real-key';
  static readonly WEBHOOK_SECRET = 'simulated-webhook-secret-not-a-real-key';
  private readonly orders = new Map<string, { amountPaise: number; payments: GatewayPayment[] }>();
  readonly refunds: { paymentId: string; amountPaise: number }[] = [];
  /** Tests can make the next call fail like a gateway outage. */
  failNext: string | null = null;

  private maybeFail() {
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      throw new GatewayError(m);
    }
  }
  async createOrder(amountPaise: number) {
    this.maybeFail();
    const id = `order_sim${randomBytes(7).toString('hex')}`;
    this.orders.set(id, { amountPaise, payments: [] });
    return { id, amountPaise };
  }
  /** What the checkout would return to the browser: a payment and its signature. */
  pay(orderId: string, outcome: 'success' | 'failure' = 'success', amountPaise?: number) {
    const o = this.orders.get(orderId);
    if (!o) throw new GatewayError('Unknown order');
    const p: GatewayPayment = { id: `pay_sim${randomBytes(7).toString('hex')}`, orderId, amountPaise: amountPaise ?? o.amountPaise, status: outcome === 'success' ? 'captured' : 'failed', method: 'upi', error: outcome === 'failure' ? 'Payment declined by the bank (simulated)' : null };
    o.payments.push(p);
    return { payment: p, signature: hmac(SimulatedGateway.KEY_SECRET, checkoutPayload(orderId, p.id)) };
  }
  private find(id: string) {
    for (const o of this.orders.values()) {
      const p = o.payments.find((x) => x.id === id);
      if (p) return p;
    }
    throw new GatewayError('Unknown payment');
  }
  async fetchPayment(id: string) {
    this.maybeFail();
    return this.find(id);
  }
  async fetchOrderPayments(orderId: string) {
    this.maybeFail();
    return this.orders.get(orderId)?.payments ?? [];
  }
  async capture(id: string) {
    const p = this.find(id);
    p.status = 'captured';
    return p;
  }
  async refund(paymentId: string, amountPaise: number) {
    this.maybeFail();
    this.find(paymentId);
    this.refunds.push({ paymentId, amountPaise });
    return { id: `rfnd_sim${randomBytes(6).toString('hex')}`, status: 'processed' };
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return safeEqual(hmac(SimulatedGateway.KEY_SECRET, checkoutPayload(orderId, paymentId)), signature);
  }
  verifyWebhook(rawBody: Buffer | string, signature: string) {
    return safeEqual(hmac(SimulatedGateway.WEBHOOK_SECRET, rawBody), signature);
  }
}

class OffGateway implements PaymentGateway {
  readonly mode = 'off' as const;
  readonly keyId = '';
  private no(): never {
    throw new GatewayError('Online payment is not set up');
  }
  createOrder = async () => this.no();
  fetchPayment = async () => this.no();
  fetchOrderPayments = async () => this.no();
  capture = async () => this.no();
  refund = async () => this.no();
  verifyCheckout = () => false;
  verifyWebhook = () => false;
}

export function createGateway(): PaymentGateway {
  const c = config();
  const keys = !!(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET);
  const mode = c.PAYMENT_GATEWAY ?? (keys ? 'razorpay' : c.NODE_ENV === 'production' ? 'off' : 'simulated');
  if (mode === 'razorpay') {
    if (!keys) throw new Error('PAYMENT_GATEWAY=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET');
    return new RazorpayGateway(c.RAZORPAY_KEY_ID!, c.RAZORPAY_KEY_SECRET!, c.RAZORPAY_WEBHOOK_SECRET!);
  }
  if (mode === 'simulated') {
    if (c.NODE_ENV === 'production') throw new Error('The simulated payment gateway cannot run in production');
    return new SimulatedGateway();
  }
  return new OffGateway();
}

export { GatewayError };
