import { z } from "zod";

export const saasJobSchema = z.object({
  jobId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum(["tenant_onboarding", "account_lifecycle", "admin_operation"]),
  action: z.string().min(1),
  attempt: z.number().int().min(1).default(1),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  requestedBy: z.string().min(1)
});

export type SaasJob = z.infer<typeof saasJobSchema>;

export type FailureDecision =
  | { disposition: "retry"; nextJob: SaasJob }
  | { disposition: "dead_letter"; record: DeadLetterRecord };

export type DeadLetterRecord = {
  type: "dead_letter";
  job: SaasJob;
  reason: string;
  failedAt: string;
};

export function decideFailure(job: SaasJob, reason: string, failedAt: string): FailureDecision {
  if (job.attempt < job.maxAttempts) {
    return { disposition: "retry", nextJob: { ...job, attempt: job.attempt + 1 } };
  }
  return { disposition: "dead_letter", record: { type: "dead_letter", job, reason, failedAt } };
}
