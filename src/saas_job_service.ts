import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai_queue";
import { drainSaasJobs } from "./queue_worker";
import { saasJobSchema } from "./job_policy";

const submissionSchema = saasJobSchema.omit({ jobId: true, attempt: true }).extend({
  jobId: z.string().min(1).optional()
});

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/jobs") {
      const input = submissionSchema.parse(await readJson(request));
      const job = { ...input, jobId: input.jobId ?? randomUUID(), attempt: 1 };
      const queued = await infrai.queue.publish(job, `job-${job.jobId}`);
      json(response, 202, { jobId: job.jobId, messageId: queued.message_id, state: "queued" });
      return;
    }
    if (request.method === "POST" && request.url === "/admin/drain") {
      const result = await drainSaasJobs(async (job) => {
        console.log(`Applying ${job.kind}/${job.action} for tenant ${job.tenantId}`);
      });
      json(response, 200, result);
      return;
    }
    json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "Invalid request body", issues: error.issues });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.message, code: error.code });
    } else {
      json(response, 500, { error: error instanceof Error ? error.message : "Unexpected service error" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`SaaS job service listening on http://localhost:${port}`));
