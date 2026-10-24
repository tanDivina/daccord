// Thin client for the PayPal REST APIs D'accord uses: Orders v2 (authorize),
// Authorizations (capture), Payouts v1 and webhook signature verification.

const BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
    public debugId?: string
  ) {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new PayPalError("PayPal OAuth failed", res.status, data);

  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  requestId?: string
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  // PayPal-Request-Id makes retries of the same POST idempotent.
  if (requestId) headers["PayPal-Request-Id"] = requestId;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new PayPalError(
      data?.message || data?.name || `PayPal ${method} ${path} failed`,
      res.status,
      data?.details ?? data,
      res.headers.get("paypal-debug-id") ?? data?.debug_id
    );
  }
  return data as T;
}

const money = (amount: number) => ({ currency_code: "USD", value: amount.toFixed(2) });

export async function createAuthorizeOrder(opts: {
  amount: number;
  description: string;
  referenceId: string;
}) {
  return call<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: opts.referenceId,
        description: opts.description.slice(0, 127),
        amount: money(opts.amount),
      },
    ],
  });
}

export async function authorizeOrder(orderId: string) {
  const order = await call<any>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    {},
    `authorize-${orderId}`
  );
  const unit = order.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("Order returned no authorization", 502, order);
  return {
    orderId: order.id as string,
    authorizationId: auth.id as string,
    status: auth.status as string,
    amount: Number(auth.amount?.value),
    expirationTime: auth.expiration_time as string | undefined,
    payerEmail: order.payer?.email_address as string | undefined,
    referenceId: unit?.reference_id as string | undefined,
  };
}

export async function getAuthorization(authorizationId: string) {
  return call<{ id: string; status: string; amount: { value: string } }>(
    "GET",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`
  );
}

export async function captureAuthorization(authorizationId: string) {
  return call<{ id: string; status: string }>(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { final_capture: true },
    `capture-${authorizationId}`
  );
}

export async function createPayout(opts: {
  senderBatchId: string;
  receiver: string;
  amount: number;
  note: string;
  subject: string;
}) {
  return call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        // PayPal rejects a reused sender_batch_id, which blocks double payouts.
        sender_batch_id: opts.senderBatchId,
        email_subject: opts.subject,
        email_message: opts.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: opts.receiver,
          amount: { currency: "USD", value: opts.amount.toFixed(2) },
          note: opts.note,
          sender_item_id: opts.senderBatchId,
        },
      ],
    }
  );
}

export async function getPayout(payoutBatchId: string) {
  return call<any>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
}

export async function verifyWebhookSignature(headers: Headers, event: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new PayPalError("PAYPAL_WEBHOOK_ID is not set", 500, null);
  const result = await call<{ verification_status: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }
  );
  return result.verification_status === "SUCCESS";
}
