---
status: proposed
date: 2026-10-28
decision-makers: repository owner (pending approval at STOP-1)
---

# 0033 — Feedback is delivered by email through Resend, with abuse limits and no stored identifiers

## Context and problem statement

The owner asked for a Feedback form whose submissions each arrive in the owner's inbox as
one email. SimpleAtom has no accounts (`app/docs/faq/page.tsx:97-103`), so the form is open
to anyone. Any spam that gets past it lands in a personal inbox. The owner's address must
never appear in code, commits, pages, logs, tests or prompts.

`vercel integration discover --category messaging` (run 2026-10-28) returned one product,
`resend/resend-email`. Installing it provisions `RESEND_API_KEY` and creates a Resend
account linked to the Vercel account
([Resend guide](https://resend.com/docs/guides/vercel-marketplace-integration.md), fetched
2026-10-28).

## Considered options

* **A. Email through Resend (Vercel Marketplace).** One plain-text email per submission.
* **B. A Supabase table.** Migration `0004_feedback.sql`, with RLS on and no anon policies.
  Supabase is reachable again (D23 resolved), but `0003_lockdown` is not applied and
  `SUPABASE_SERVICE_ROLE_KEY` is unset, so writes would still use the anon key.
* **C. GitHub issues through a bot token.** Public by default, so visitors' text would be
  published. Rejected on privacy grounds.
* **D. A third-party form service.** A new processor of visitors' text, outside the Vercel
  Marketplace's billing and env provisioning.

## Decision outcome

Chosen option: "A. Email through Resend". It was the owner's choice, it is the Marketplace's
only messaging integration, and it needs no database or public artefact. **Email is
delivery, not a record.** If searchable history is wanted later, option B is the follow-up,
blocked on 0003 and the service-role key.

**Delivery**

* `lib/server/feedback-delivery.ts` exposes one interface,
  `deliver(message) → {ok: true, id} | {ok: false, reason}`, following the server-only
  pattern of `share-store.ts`. The production implementation calls Resend's Node SDK
  `emails.send({from, to, subject, text, replyTo})` and reports success **only** when the
  SDK returns `data.id`. The SDK does not throw on API errors; it returns `error`
  ([send-email docs](https://resend.com/docs/api-reference/emails/send-email.md), fetched
  2026-10-28).
* An idempotency key (a hash of the submission token) makes a double click send at most once.
* Env vars, all set by the owner: `RESEND_API_KEY` (from the integration), `FEEDBACK_TO_EMAIL`
  and `FEEDBACK_FROM_EMAIL`. If any is missing, the route answers 503 `feedback_unavailable`
  and nothing is sent.

**Sender**

* Resend's test sender `onboarding@resend.dev` "can only send emails to the email address
  associated with your Resend account"
  ([Resend KB](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.md), fetched
  2026-10-28). It therefore works before domain verification **only if** `FEEDBACK_TO_EMAIL`
  is that same account address.
* Otherwise the sender is an address on a verified `simpleatom.app` subdomain. The DNS
  records are an owner action, and the integration's "Auto configure" can add them to the
  Vercel-managed zone.

**The email**

* Plain text only. No HTML is ever built from visitor input.
* Subject: the fixed text `SimpleAtom feedback`, plus ` — ` and the category label from the
  allow-list. CR and LF are stripped from every header value.
* Body: the message, then a `--- context ---` block holding only the fields the visitor left
  in: route, app version, git commit, manifest hash or MACE Link id.
* `replyTo` is the visitor's address, if a valid one was given (≤ 254 characters, one `@`, no
  CR or LF). It is never written into the subject.

**Abuse limits**

| Limit | Value | Where |
|---|---|---|
| Edge rate limit | `POST /api/feedback`, 3 per 10 min per IP, fixed window; starts as Log, then 429 | Vercel WAF rule. The owner creates it in the dashboard; rate limits cannot be declared in `vercel.json` ([rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), fetched 2026-10-30). Counters are per region, so the in-code limits below stay authoritative |
| Message length | 1–4,000 characters after trim | client and server |
| Body size | ≤ 16 KB, checked before parsing | server (`content-length`, then `text()`) |
| Honeypot | a hidden `website` field must be empty; a filled one gets a fake 202 and sends nothing | server |
| Minimum time to submit | ≥ 3 s between the page-issued token and the submission | server. The token is `issuedAt` signed with HMAC-SHA256, under a key derived by HKDF from `RESEND_API_KEY` (info string `simpleatom-feedback-token-v1`), so no new secret is needed |
| Token age | ≤ 2 h | server |
| Per visitor | 3 per 10 min and 10 per 24 h | server, in memory, keyed by `HMAC(key, client IP)` truncated to 16 bytes. Best effort on serverless, like `/api/share` |
| Global daily cap | 40 accepted sends per UTC day per instance. Beyond that the route refuses with 429 `feedback_daily_cap` and the message "Feedback is closed for today. Please try again tomorrow." | server, in memory |
| Provider backstop | the Resend free plan's 100 emails/day; `daily_quota_exceeded` maps to the same honest refusal | Resend ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits.md), fetched 2026-10-28) |

**Privacy**

* No raw IP address is stored, logged or sent. The rate-limit key is a keyed hash held only
  in memory.
* The user agent is not collected.
* The form says what is sent (the message, the optional reply address, and the context the
  visitor chose to keep), who reads it (the maintainer, by email), and for how long (until
  the maintainer deletes it; Resend's own logs keep message data for 30 days according to
  its quota page above). It also says "Email is delivery, not a record".

**Honest failure**

* The page reports success only after a 202 from the route, which itself follows the
  provider's `data.id`.
* Any failure shows "Feedback couldn't be sent. Please try again later." and keeps the
  visitor's text in the box.

### Consequences

* Good, because each submission reaches the owner's inbox and can be answered by Reply,
  with no database to secure.
* Good, because no identifier that could tie a visitor to a submission is stored.
* Bad, because the per-visitor and daily limits are per instance and best effort. A
  distributed sender can exceed 40 a day across instances, until Resend's 100-a-day quota
  stops it. A durable cap needs shared state (option B, later).
* Bad, because it adds an external processor (Resend) and four owner actions: install the
  integration, verify the domain, set the env vars, and create the WAF rule.
* Note: Spend Management does not cover Marketplace integrations
  ([spend management](https://vercel.com/docs/spend-management), fetched 2026-10-30), so
  Resend's own free-plan quota (100/day) is the cost backstop for email, not Vercel's
  budget.

### Confirmation

* `test/feedback.test.ts` (vitest) runs against a test double of `feedback-delivery.ts` and
  never sends real email. It covers:
  * validation;
  * the honeypot;
  * the minimum time and the token signature;
  * the per-visitor and global caps;
  * subject and body construction, including CR/LF stripping;
  * that the body is plain text;
  * the provider-error → 502 path, and the missing-env → 503 path.
* Browser check: a local submission reaches the double, the error states render, the form is
  usable from the keyboard alone, and it fits at 375 px.
* Production, after approval: one real submission, which the owner confirms received, and
  one forced failure that shows the honest error.

## More information

* `app/api/share/route.ts` (the pattern for body caps, `ApiError` and rate limits) and
  `lib/server/share-store.ts`.
* Resend Node SDK `resend` 6.35.0, Node ≥ 20 (`registry.npmjs.org/resend/latest`, fetched
  2026-10-28). It is installed with the integration's agent skill, not from memory.
* `docs/v2/plan-2026-10-28.md` §Feedback.
