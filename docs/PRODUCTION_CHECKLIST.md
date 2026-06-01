# Production checklist

Use this checklist before enabling snapfeed outside local development or a small controlled staging cohort.

snapfeed is designed for **internal dogfooding**, not public customer support. Keep the widget behind your own access controls and route feedback through server-side handlers.

## 1. Use the server-side handler path

✅ Recommended:

```ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { autoAdapters } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: autoAdapters(),
  allowedOrigins: ['https://staging.example.com'],
  rateLimit: { max: 10, windowMs: 60_000 },
})
```

Avoid putting provider tokens, webhook URLs, or service-role keys in browser code. In production, prefer `<FeedbackProvider apiUrl="/api/feedback" />` plus server-side adapters.

## 2. Gate widget visibility

`enableInProduction` defaults to `false`. When you intentionally show snapfeed in production-like environments, gate it with your own auth/role logic:

```tsx
<FeedbackProvider
  appName="Checkout"
  enableInProduction={currentUser.role === 'employee' || currentUser.role === 'qa'}
>
  {children}
</FeedbackProvider>
```

Do not expose the widget to anonymous public traffic unless you have added your own abuse controls.

## 3. Lock down origins

Set `allowedOrigins` on every production handler. Treat an omitted/empty allowlist as a development convenience only.

```ts
allowedOrigins: [
  'https://staging.example.com',
  'https://app.example.com',
]
```

## 4. Enable rate limiting

Start with a conservative per-origin/per-IP limit and tune from real traffic:

```ts
rateLimit: { max: 10, windowMs: 60_000 }
```

For horizontally scaled deployments, use an external/shared rate-limit store rather than relying only on in-memory process state.

## 5. Sanitize and minimize captured data

- Keep automatic metadata useful but minimal.
- Review screenshot and console-error capture with your privacy/security team.
- Use the built-in console-error sanitizer, and add your own redaction for domain-specific secrets.
- Do not capture production customer PII unless your consent, retention, and deletion process covers it.

## 6. Configure storage, retention, and deletion

- Decide where screenshots/uploads live.
- Set a retention window.
- Use `deleteByUserId()` for snapfeed-managed uploads/audit trails when honoring deletion requests.
- Delete downstream artifacts directly in systems such as Slack, JIRA, Linear, GitHub, or email.

See [`gdpr.md`](./gdpr.md) for the detailed deletion runbook.

## 7. Audit the dispatch path

For regulated or high-trust environments:

- Enable audit logging for adapter dispatches.
- Ship audit logs to an append-only sink such as WORM object storage, CloudWatch with delete-deny policy, or SIEM/syslog.
- Keep adapter credentials in your secret manager, not in repository files.

## 8. Run doctor before release

```bash
npx snapfeed doctor --prod
```

`--prod` performs the normal setup checks plus static guardrail checks for explicit `allowedOrigins` and `rateLimit` in the detected Next.js handler.

If you also have a running deployment to probe:

```bash
npx snapfeed doctor --prod --probe=https://staging.example.com/api/feedback
```

## 9. Package and dependency review

Before a release or major internal rollout:

```bash
npm ci
npm run type-check
npm run lint
npm run build
npm test
npm audit --omit=dev
npm pack --dry-run
npm sbom --json > snapfeed-sbom.json
```

Production dependencies should have no high/critical findings. Dev-only findings still need review before release engineering signs off.

## 10. Enterprise/security review packet

For corp/regulated adoption, prepare:

- README and architecture overview
- [`SECURITY.md`](../SECURITY.md)
- [`THREAT_MODEL.md`](../THREAT_MODEL.md)
- [`COMPLIANCE.md`](../COMPLIANCE.md)
- [`PRIVACY.md`](../PRIVACY.md)
- SBOM generated with `npm sbom`
- Container digest pinning evidence if using Docker
- Data-flow diagram and retention/deletion runbook

## Launch posture

Recommended public positioning for v0.6.x:

> Production-usable for internal teams that own their integration and follow the production checklist. Enterprise controls such as turnkey SSO/SAML admin, fully managed multi-tenant hosting, and org-specific compliance automation remain roadmap items.
