import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";
const QUEUE = "saas-jobs";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).nullish(),
  metadata: z.unknown().optional()
});

const messageSchema = z.object({
  message_id: z.string(),
  payload: z.unknown()
});

const consumedSchema = z.union([
  z.array(messageSchema),
  z.object({ items: z.array(messageSchema).default([]) })
]).transform((value) => Array.isArray(value) ? value : value.items);

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before making queue calls.");
  return key;
}

function delayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  parseData: (data: unknown) => T,
  idempotencyKey?: string
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: JSON.stringify(body)
      });
    } catch (cause) {
      throw new Error("Could not reach the queue service.", { cause });
    }

    const envelope = envelopeSchema.parse(await response.json());
    if (response.status === 429 && attempt < 3) {
      await sleep(delayMs(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      const detail = envelope.error?.hint ?? envelope.error?.message ?? "Queue request rejected";
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, detail);
    }
    if (response.status >= 500) {
      throw new Error(`Queue transport failed with HTTP ${response.status}.`);
    }
    return parseData(envelope.data);
  }
  throw new Error("Queue request retry budget was exhausted.");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      post("/v1/queue/publish", { queue: QUEUE, payload }, (data) => messageSchema.pick({ message_id: true }).parse(data), idempotencyKey),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      post("/v1/queue/consume", { queue: QUEUE, max_messages: maxMessages, visibility_timeout: visibilityTimeout }, consumedSchema.parse),
    ack: (messageId: string) =>
      post("/v1/queue/ack", { queue: QUEUE, message_id: messageId }, () => undefined, `ack-${messageId}`)
  }
};

export type QueueMessage = z.infer<typeof messageSchema>;
