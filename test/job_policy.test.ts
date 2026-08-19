import assert from "node:assert/strict";
import test from "node:test";
import { decideFailure, type SaasJob } from "../src/job_policy";

const accountClosure: SaasJob = {
  jobId: "job-1042",
  tenantId: "studio-17",
  kind: "account_lifecycle",
  action: "close_creator_workspace",
  attempt: 3,
  maxAttempts: 3,
  requestedBy: "admin@example.com"
};

test("a poison account job becomes a dead-letter record at its attempt limit", () => {
  const decision = decideFailure(accountClosure, "workspace still has a live stream", "2026-08-19T08:00:00.000Z");

  assert.equal(decision.disposition, "dead_letter");
  if (decision.disposition === "dead_letter") {
    assert.equal(decision.record.job.tenantId, "studio-17");
    assert.equal(decision.record.reason, "workspace still has a live stream");
    assert.equal(decision.record.failedAt, "2026-08-19T08:00:00.000Z");
  }
});

test("an onboarding job below its limit is republished with the next attempt", () => {
  const job: SaasJob = { ...accountClosure, kind: "tenant_onboarding", attempt: 1 };
  const decision = decideFailure(job, "asset import is still running", "2026-08-19T08:00:00.000Z");

  assert.equal(decision.disposition, "retry");
  if (decision.disposition === "retry") assert.equal(decision.nextJob.attempt, 2);
});
