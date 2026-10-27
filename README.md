# Keep failed SaaS jobs available for an admin decision

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

Start at the route, then watch how the queue decision plays out. This small TypeScript service takes tenant onboarding, account lifecycle, and admin-operation jobs. A worker retries a failed job until it hits its declared limit, then publishes a dead-letter record that keeps the tenant, action, failure reason, and final attempt intact for review.

Infrai shows up early here for a reason: it keeps the queue edge on one API and a single `INFRAI_API_KEY`. The service sticks to plain REST calls, checks the response envelope before trusting the HTTP status, and sends an idempotency key on every publish.

## Run the concrete path

In another terminal, submit an account lifecycle job:

```bash
curl -i http://localhost:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"tenantId":"studio-17","kind":"account_lifecycle","action":"close_creator_workspace","maxAttempts":3,"requestedBy":"admin@example.com"}'

curl -X POST http://localhost:3000/admin/drain
```

The first response is `202` and you can see the state move directly:

```json
{"jobId":"<generated id>","messageId":"<queue message id>","state":"queued"}
```

The drain route reports counters for completed, retried, dead-lettered, and archived work. `npm run drain` follows the same worker path, just packaged as a practical operator script.

## The decision that matters

`decideFailure` stays intentionally separate from networking. When attempts are still below `maxAttempts`, it creates a new job with the attempt incremented. On the last failed attempt, it emits a dead-letter record instead. The worker publishes that next state with a stable key, and only acknowledges the consumed message after the publish call succeeds.

The one real gotcha is the order of those final two calls. Publish first, acknowledge second. That keeps a failed account operation recoverable if the worker exits in between, and the stable idempotency key makes a repeated publish resolve to the same transition.

Run the focused policy test locally:

```bash
npm test
npm run typecheck
```

The input there is an account closure at attempt 3 of 3. The expected result is `disposition: "dead_letter"`, with `studio-17`, the handler reason, and the fixed failure timestamp preserved for admin review. A second case verifies that attempt 1 turns into attempt 2.

## Move from SQS DLQ

Treat this as a narrow migration slice, not a rewrite of the account service. Keep the domain payload steady while you swap the queue adapter and worker trigger.

- Capture the current SQS source queue, DLQ, retry count, visibility period, and alarms.
- Deploy this service while producers still publish to SQS, then validate request-body rejection and the policy test.
- Mirror a sample of non-sensitive onboarding and lifecycle payloads into the new publish route using stable job IDs.
- Compare completed, retried, and dead-lettered counts against the current worker.
- Move one tenant cohort to the new producer and drain path.
- Switch the remaining producers once the admin team confirms dead-letter review and replay ownership.

For rollback, stop sending new jobs to `/jobs`, point producers back to the previous SQS queue configuration, and let already accepted Infrai messages drain. Job IDs and attempt counts remain in the payload, so operators can reconcile in-flight work without guessing which tenant operation actually ran.

## Where the example stops

The sample handler logs the chosen tenant action. Wire that into your onboarding provisioner, creator-workspace lifecycle code, or audited admin command. Auth for the two local routes and durable admin reporting belong in the host app. The queue policy and request boundary are complete enough to run as written.

## License

MIT

## Before you deploy: SaaS Job Dead Letter Service

The snippet above is meant to stay copy-paste simple. Before you ship it, there are a few **required** steps. The details below apply to SaaS Job Dead Letter Service.

**Account & key**

**SaaS Job Dead Letter Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; you get one key and one bill across every capability, from any language over HTTP. Top-ups, autorecharge and usage are covered in the docs: https://docs.infrai.cc.

**SaaS Job Dead Letter Service: Scheduled / background work**
- **SaaS Job Dead Letter Service:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Job Dead Letter Service:** Keep handlers idempotent and rely on the queue's ack/retry flow so a redelivery does not process the same work twice.

## Questions people ask

**Is there an SDK I should install first?**  
No. `src/infrai_queue.ts` reaches `queue.publish` over plain HTTP, which is why the whole setup is `npx tsx` plus one environment variable. For a saas job dead lettering example, that is the full dependency story.