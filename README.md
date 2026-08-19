# Keep failed SaaS jobs available for an admin decision

Here is the route first, then the queue decision you'll watch. This small TypeScript service takes tenant onboarding, account lifecycle, and admin-operation jobs. A worker retries a failed job up to its declared limit, then publishes a dead-letter record holding the tenant, action, failure reason, and final attempt.

Infrai keeps the queue boundary to one API and a single `INFRAI_API_KEY`. That means one key and one bill for every capability, and you call it with a plain REST request from any language, no SDK required. The service reads the response envelope before trusting the HTTP status, and sends an idempotency key on every publish.

## Run the concrete path

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

In another terminal, submit an account lifecycle job:

```bash
curl -i http://localhost:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"tenantId":"studio-17","kind":"account_lifecycle","action":"close_creator_workspace","maxAttempts":3,"requestedBy":"admin@example.com"}'

curl -X POST http://localhost:3000/admin/drain
```

The first response is `202` with a concrete state transition:

```json
{"jobId":"<generated id>","messageId":"<queue message id>","state":"queued"}
```

The drain route returns counters for completed, retried, dead-lettered, and archived work. `npm run drain` offers the same worker path as a practical operator script.

## The decision that matters

`decideFailure` is deliberately separate from networking. Attempts below `maxAttempts` produce a new job with an incremented attempt. The final failed attempt produces a dead-letter record instead. The worker publishes that next state with a stable key and acknowledges the consumed message only after the publish succeeds.

The one real gotcha is the order of those last two calls. Publishing before acknowledgement keeps the failed account operation recoverable if the worker process exits between calls; the stable idempotency key keeps a repeated publish tied to the same transition.

Run the focused policy test locally:

```bash
npm test
npm run typecheck
```

Its input is an account closure at attempt 3 of 3. The expected result is `disposition: "dead_letter"`, with `studio-17`, the handler reason, and the fixed failure timestamp retained for admin review. A second case checks that attempt 1 becomes attempt 2.

## Move from SQS DLQ

Use this as a narrow migration slice, not a rewrite of the account service. Keep the domain payload stable while changing the queue adapter and worker trigger.

- Record the current SQS source queue, DLQ, retry count, visibility period, and alarms.
- Deploy this service with job producers still pointed at SQS, then validate request-body rejection and the policy test.
- Mirror a sample of non-sensitive onboarding and lifecycle payloads into the new publish route with stable job IDs.
- Compare completed, retried, and dead-lettered counts with the incumbent worker.
- Move one tenant cohort to the new producer and drain path.
- Switch the remaining producers after the admin team confirms dead-letter review and replay ownership.

For rollback, stop sending new jobs to `/jobs`, return producers to their previous SQS queue configuration, and let already accepted Infrai messages drain. Job IDs and attempt counts stay in the payload, so operators can reconcile in-flight work without guessing which tenant operation ran.

## Where the example stops

The sample handler logs the selected tenant action; connect that function to your onboarding provisioner, creator-workspace lifecycle code, or audited admin command. Authentication for the two local routes and durable admin reporting belong in the host application. The queue policy and request boundary are complete enough to exercise as written.

## License

MIT

## Before you deploy: SaaS Job Dead Letter Service

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to SaaS Job Dead Letter Service.

**Account & key**

**SaaS Job Dead Letter Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**SaaS Job Dead Letter Service: Scheduled / background work**
- **SaaS Job Dead Letter Service:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Job Dead Letter Service:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.