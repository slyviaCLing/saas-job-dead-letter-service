import { drainSaasJobs } from "../src/queue_worker";

const result = await drainSaasJobs(async (job) => {
  console.log(`Completed ${job.kind}/${job.action} for ${job.tenantId}`);
});

console.log(JSON.stringify(result, null, 2));
