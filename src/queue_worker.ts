import { infrai } from "./infrai_queue";
import { decideFailure, saasJobSchema, type SaasJob } from "./job_policy";

type JobHandler = (job: SaasJob) => Promise<void>;

export type DrainResult = {
  completed: number;
  retried: number;
  deadLettered: number;
  archived: number;
};

export async function drainSaasJobs(handler: JobHandler): Promise<DrainResult> {
  const result: DrainResult = { completed: 0, retried: 0, deadLettered: 0, archived: 0 };
  const messages = await infrai.queue.consume(10, 60);

  for (const message of messages) {
    const possibleRecord = zDeadLetterRecord(message.payload);
    if (possibleRecord) {
      console.log(`Dead-letter review: ${possibleRecord.job.kind}/${possibleRecord.job.jobId}: ${possibleRecord.reason}`);
      await infrai.queue.ack(message.message_id);
      result.archived += 1;
      continue;
    }

    const job = saasJobSchema.parse(message.payload);
    try {
      await handler(job);
      await infrai.queue.ack(message.message_id);
      result.completed += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Job handler rejected the operation";
      const decision = decideFailure(job, reason, new Date().toISOString());
      const payload = decision.disposition === "retry" ? decision.nextJob : decision.record;
      const suffix = decision.disposition === "retry" ? `attempt-${decision.nextJob.attempt}` : "dead-letter";
      await infrai.queue.publish(payload, `${job.jobId}-${suffix}`);
      await infrai.queue.ack(message.message_id);
      if (decision.disposition === "retry") result.retried += 1;
      else result.deadLettered += 1;
    }
  }
  return result;
}

function zDeadLetterRecord(payload: unknown): { job: SaasJob; reason: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (value.type !== "dead_letter" || typeof value.reason !== "string") return null;
  const parsed = saasJobSchema.safeParse(value.job);
  return parsed.success ? { job: parsed.data, reason: value.reason } : null;
}
