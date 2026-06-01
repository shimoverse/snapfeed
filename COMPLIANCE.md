# Compliance Posture

> **Honest read of where snapfeed sits relative to common regulatory regimes.** snapfeed is a self-hosted MIT library, not a service. The maintainers operate no infrastructure and process no end-user data. As a result, almost every regulatory obligation falls on the **consumer** (the organization that embeds and operates the library). This document maps each regime to what snapfeed provides versus what the consumer must implement.

Last updated: 2026-06-01 (snapfeed v0.6.0)

---

## TL;DR

| Regime | Does snapfeed have a certification? | Can a consumer build a compliant deployment? |
|---|---|---|
| GDPR | N/A — not a controller / processor | Yes — consumer is controller; sign DPA with adapter destinations |
| CCPA / CPRA | N/A — not a "service provider" | Yes — consumer satisfies California obligations |
| HIPAA | No (no BAA available) | Yes — self-hosted Docker + Ollama + redaction + audit log |
| SOC 2 | No (we operate no service) | Inherited from consumer's own SOC 2 controls |
| PCI DSS | No | Yes if PAN never enters snapfeed (recommended) |
| ISO 27001 / 27017 / 27018 | No | Inherited from consumer's ISMS |
| FedRAMP | No (no ATO) | Yes if deployed inside an existing ATO boundary |
| Section 508 / WCAG 2.1 AA | Targets AA; full external audit still pending | Partial — see accessibility section |

---

## GDPR

snapfeed is a **library**, not a controller or a processor under Article 4. The maintainers have no access to personal data and no relationship with data subjects.

| GDPR concept | Where the obligation lives |
|---|---|
| Controller | The consumer (the organization deploying snapfeed) |
| Processor | Each adapter destination (Slack, JIRA, Linear, Supabase, etc.) the consumer wires up — and any LLM provider |
| Sub-processor | The adapter destination's own infrastructure providers |
| International data transfer | Determined entirely by where the consumer deploys and where their adapter destinations store data; snapfeed itself transfers nothing |
| DPA | Consumer signs a DPA with each adapter destination provider; a starter template is at `legal/DPA-template.md` |
| Right of access (Art. 15) | Consumer must implement against their adapter destinations |
| Right to erasure (Art. 17) | Consumer must implement against their stores; snapfeed provides `deleteByUserId()` plus `pruneOlderThan({ retentionDays })` helpers for its own audit/storage primitives |
| Right to rectification (Art. 16) | Consumer must implement against their stored data |
| Records of processing (Art. 30) | Consumer maintains; the audit log (`src/audit-log.ts`) provides the per-event record of what was dispatched where |
| Data Protection Officer | Consumer's responsibility |
| 72-hour breach notification (Art. 33) | Consumer's responsibility |

**Recommended GDPR posture for the consumer:**

1. Treat snapfeed as an internal-only library; document it in your Article 30 record-of-processing-activities under "internal product feedback."
2. Sign a DPA with every destination provider you wire up (Slack, Atlassian, Linear, etc.). Adapt `legal/DPA-template.md` for your customers if you in turn act as a processor.
3. Enable `redactBeforeLLM` if any GenAI provider sits outside the EEA, or use `provider: 'ollama'` in-tenant.
4. Wire `fileAuditLog` (or your own implementation) so you can demonstrate Article 30 compliance.
5. Document a deletion runbook against each destination; use snapfeed `deleteByUserId()` for snapfeed-managed audit/storage artifacts and provider-native deletion APIs for downstream systems.

---

## CCPA / CPRA

Same structural pattern as GDPR. snapfeed maintainers are not a "service provider" under §1798.140(ag) because we receive no personal information from the consumer. The consumer is the "business" under the law.

The consumer must:

- Disclose the categories of personal information collected via the widget (text, identity, screenshots, browser metadata) in their California-resident-facing privacy notice.
- Implement the consumer-rights workflow (right to know, delete, correct, opt-out of sale/share — though snapfeed sells nothing).
- Sign service-provider agreements with each adapter destination if any of those destinations qualify as service providers under the CCPA.

---

## HIPAA

**snapfeed has no BAA available and is not certified for PHI.** The maintainers will not sign a BAA because the maintainers handle no data.

Healthcare consumers must self-assess. A reasonable HIPAA-aligned deployment looks like:

- Run the **self-hosted Docker stack** (`docker/docker-compose.yml`) inside the consumer's existing HIPAA-aligned infrastructure (e.g. AWS BAA-covered account).
- Use an **air-gapped LLM** — `provider: 'ollama'` running locally; do not call third-party LLM APIs that have not signed a BAA with the consumer.
- Enable `redactBeforeLLM` (`redactForLLM` in `src/llm/redact.ts`) so emails, JWTs, and high-entropy tokens are stripped before any prompt — this is a defense-in-depth, not a HIPAA control on its own.
- Enable the **audit log** (`fileAuditLog` from `src/audit-log.ts`) and ship events to an append-only sink (HIPAA §164.312(b) audit controls).
- Choose adapter destinations that are themselves HIPAA-aligned and BAA-covered for the consumer (e.g. consumer's own Postgres in their BAA-covered account; a HIPAA-eligible Slack tier; etc.). Do **not** route to consumer-grade webhooks (Discord, Telegram) for PHI.
- Disable `screenshot` and `voice` features for PHI workflows unless the consumer can guarantee in-app PHI is masked.

---

## SOC 2

snapfeed has **no SOC 2 report**. The maintainers operate no service that could be in scope for a SOC 2 audit.

Consumers running snapfeed inside their own SOC 2 boundary inherit the consumer's controls. The features below map to SOC 2 Trust Services Criteria for documenting how the snapfeed deployment supports those controls:

| TSC | Criterion | snapfeed feature that supports it |
|---|---|---|
| CC6.1 | Logical access controls | Server-side adapters, secrets in `process.env`, no client-side credentials |
| CC6.6 | Encryption | Consumer terminates TLS in front of `/feedback`; adapter destinations encrypt in transit and at rest per their providers |
| CC6.7 | Restriction of unauthorized use | `allowedOrigins` + `enableInProduction: false` default + role gating |
| CC7.2 | System monitoring | `fileAuditLog` events: `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit` |
| CC7.3 | Anomaly detection | Rate limiter; audit log enables downstream anomaly alerting |
| CC7.4 | Incident response | Audit log + responsible-disclosure process in `SECURITY.md` |
| CC8.1 | Change management | Pinned `package-lock.json`; deterministic Docker build; CHANGELOG |
| CC9.2 | Vendor management | DPA template at `legal/DPA-template.md`; per-adapter sub-processor list |

When the consumer's auditor asks "what is snapfeed?" — the answer is "an open-source npm dependency we self-host inside our SOC 2 boundary; it inherits our existing controls; here's the source." It is the same conversation as `react` or `express`, not the same conversation as a SaaS sub-processor.

---

## PCI DSS

**Payment card data should never enter snapfeed.** The library is not in PCI scope unless it processes Primary Account Numbers (PAN).

Risks specific to snapfeed:

- **Screenshots can capture PAN displayed on screen** during checkout testing. Consumers in PCI scope must mask card numbers in their own application UI before any screenshot is possible.
- The `redactForLLM` pre-redaction pass includes a `CC_PATTERN` that strips credit-card-shaped 13–19 digit groups before LLM processing, but this is best-effort and **not** a PCI control. It is not a substitute for keeping PAN out of feedback in the first place.
- Disable `autoScreenshot` for cardholder-data-environment (CDE) routes if the consumer cannot guarantee no PAN is rendered.

Recommendation: deploy snapfeed **outside** the CDE. If a tester needs to file feedback about the checkout flow, route it from a non-CDE staging environment with synthetic test card data.

---

## ISO 27001 / 27017 / 27018

Same pattern as SOC 2. snapfeed has no certification of its own. A self-hosted deployment inherits the consumer's ISMS controls. Useful mappings for the consumer's Statement of Applicability:

- **A.5.15 (Access control)** — server-side adapters keep credentials off the client; `allowedOrigins` rejects unauthorized origins.
- **A.5.34 (Privacy and PII)** — `redactForLLM`, `sanitizeConsoleError`, optional `hashReporter` in the audit log.
- **A.8.16 (Monitoring)** — `fileAuditLog` event union.
- **A.8.24 (Cryptography)** — consumer terminates TLS; AWS SigV4 for `s3Storage` uses pure `node:crypto`.

ISO 27018 (PII processor) is structurally inapplicable because the maintainers are not a processor. ISO 27017 (cloud services) is structurally inapplicable because there is no snapfeed cloud service.

---

## FedRAMP

snapfeed has **no FedRAMP authorization**. The library can be deployed inside a consumer's FedRAMP-authorized environment as a component, in which case it inherits the boundary's controls.

For deployment in a FedRAMP boundary:

- Use the self-hosted Docker stack and pin image digests in your deployment pipeline.
- Use only adapter destinations that are themselves FedRAMP-authorized at the appropriate impact level.
- Use `provider: 'ollama'` for any LLM features; do not call third-party LLM APIs.
- Wire the audit log to the boundary's existing SIEM.

---

## Section 508 / WCAG 2.1 AA accessibility

Current widget targets **WCAG 2.1 AA**. A full external audit + remediation pass remains a roadmap item.

| Item | Status in v0.6 |
|---|---|
| Keyboard navigation | Hotkey activation; trigger button is a real `<button>`; tab order through form fields |
| Focus management | Focus moves to the widget on open; focus trap inside the dialog; focus returns to trigger on close |
| ARIA labels | Trigger button labeled; dialog has `role="dialog"`; form fields have `<label>` associations |
| Color contrast | Default `accentColor: "#B85A36"` (~4.7:1 against white) meets WCAG AA on the default light theme. The previous `#D4714B` failed AA (~3.1:1) and was changed in v0.5.2. Consumer-overridable colors are not contrast-checked. |
| Screen reader support | Form is semantic HTML; dynamic state changes (recording, sending) need ARIA-live regions — partial coverage |
| Reduced motion | `prefers-reduced-motion` honored for entrance/exit transitions |
| Touch target size | All interactive elements ≥44×44 CSS px on mobile |
| Captions for voice | Voice clips are not auto-captioned; consumers must add transcription if accessibility-required |

Known gaps:

- Full audit by an external WCAG-certified reviewer.
- ARIA-live announcements for async state changes.
- Color-contrast checking of consumer-supplied `accentColor`.
- Per-locale RTL layout pass.

---

## Data residency

snapfeed itself does not move data. **Residency = wherever the consumer hosts the worker + wherever the configured adapters store data.**

Generic guidance per built-in adapter:

| Destination | Residency knob |
|---|---|
| Slack | Region of the workspace; Enterprise Grid customers can pick a region. Webhook traffic terminates in Slack's chosen region. |
| Microsoft Teams | Region of the M365 tenant. |
| Discord / Telegram | No residency control offered by the provider. Avoid for residency-sensitive deployments. |
| Atlassian (JIRA) | JIRA Cloud offers per-product data residency (US, EU, Australia, Germany, Japan, etc.) — set on the Atlassian organization. |
| Linear | US-hosted; check Linear's current residency offerings. |
| GitHub | github.com is US-hosted; GitHub Enterprise Server lets the consumer host on-prem. |
| Asana | Region selectable on enterprise tier. |
| ClickUp | US-hosted. |
| Notion | US-hosted; EU residency for Enterprise customers as of 2024. |
| Supabase | Region selected at project creation. |
| Google Sheets (`googleSheetsAdapter`) | Workspace region; service-account requests terminate in Google's cloud. |
| `s3Storage` | Bucket region (consumer-chosen); same for R2 / B2 / MinIO. |
| `fileAdapter` / `fileAuditLog` | Wherever the worker host's disk is. |
| `webhookAdapter` | Wherever the consumer's endpoint is. |
| LLM (Anthropic / OpenAI) | Provider's region; check each provider's current regional offerings. |
| LLM (Azure OpenAI) | Region selected at Azure resource creation — the strongest residency story for hosted LLM. |
| LLM (Bedrock) | AWS region of the Bedrock invocation. |
| LLM (Ollama) | The host the consumer runs Ollama on — full residency control. |

For the strongest data-residency posture: deploy the worker in the consumer's chosen region, point the widget at it, use only adapter destinations with matching residency, and use Azure OpenAI / Bedrock / Ollama for LLM features.
