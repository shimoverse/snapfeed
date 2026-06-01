# Data Processing Addendum — Template

> **Template — adapt with legal counsel before use.** This is boilerplate, not legal advice. The snapfeed maintainers are not a party to any DPA the consumer signs. The maintainers do not provide a hosted service, do not process personal data on the consumer's behalf, and are therefore not a processor of the consumer.
>
> **This template assumes the consumer is the Processor and their customer is the Controller** (typical B2B SaaS pattern). For B2C apps where the consumer is the Controller and an adapter destination provider is the Processor, invert the roles and the responsibilities accordingly.

This Data Processing Addendum ("**DPA**") forms part of the Master Services Agreement (or equivalent agreement) between **\[Customer Legal Name\]** ("**Controller**") and **\[Your Company Legal Name\]** ("**Processor**") (together, the "**Parties**") and applies whenever Processor processes Personal Data on behalf of Controller in connection with the Services.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| **Controller** | The natural or legal person which determines the purposes and means of the processing of Personal Data. In this DPA: \[Customer\]. |
| **Processor** | The natural or legal person which processes Personal Data on behalf of the Controller. In this DPA: \[Your Company\]. |
| **Sub-processor** | Any third party engaged by the Processor to process Personal Data on Controller's behalf, including the destinations Processor configures via the snapfeed library. |
| **Personal Data** | Any information relating to an identified or identifiable natural person, as defined in Article 4(1) GDPR. |
| **Data Subject** | An identified or identifiable natural person whose Personal Data is processed. |
| **Processing** | Any operation performed on Personal Data, as defined in Article 4(2) GDPR. |
| **Applicable Data Protection Law** | GDPR, UK GDPR, CCPA / CPRA, and any other privacy legislation applicable to the Processing. |
| **Standard Contractual Clauses (SCCs)** | The clauses adopted by the European Commission Decision 2021/914 of 4 June 2021. |

---

## 2. Subject matter and duration of processing

**Subject matter.** Processor processes Personal Data submitted by Controller's authorized users through the in-product feedback mechanism powered by the open-source `snapfeed` library, for the purpose of receiving, routing, and acting on user feedback about Controller's product.

**Duration.** This DPA is effective for the term of the Master Services Agreement, plus the period necessary for Processor to fulfill its post-termination obligations (typically 30 days for return or deletion of Personal Data).

---

## 3. Nature and purpose of processing

| | |
|---|---|
| **Nature** | Receipt, validation, routing, and dispatch of feedback messages — including optional screenshots, voice clips, and browser metadata — to bug-tracking, team-chat, and storage systems chosen by Controller. Optional GenAI summarization, severity inference, and deduplication using a Controller-approved LLM provider. |
| **Purpose** | Improvement of Controller's product based on feedback from Controller's users. |

---

## 4. Type of Personal Data and categories of Data Subjects

**Personal Data processed:**

- Identifiers: feedback reporter name and email address (when provided by the Data Subject)
- User-generated content: free-form feedback text, screenshots, voice recordings (each optional and user-initiated)
- Browser-collected technical data: page URL, page name, viewport size, user agent, last-N captured `console.error` strings (with secrets pre-redacted)
- Optional network capture: last-N HTTP request URLs, methods, statuses, durations (with origin redaction available)

**Categories of Data Subjects:**

- Controller's authenticated users
- Controller's employees, testers, and beta participants

**Special category data:** None expected. Controller agrees not to instruct the Processor to process special category data (Art. 9 GDPR) through the feedback mechanism. If Controller's product handles such data and a Data Subject voluntarily includes it in a feedback message, Controller is responsible for additional safeguards.

---

## 5. Sub-processors

Processor engages the following Sub-processors to support feedback delivery. Controller authorizes the use of these Sub-processors as of the Effective Date.

| # | Sub-processor | Purpose | Location | Adequacy mechanism |
|---|---|---|---|---|
| 1 | \[e.g., Slack Technologies\] | Team chat notification | \[Region\] | \[SCCs / DPF / N/A\] |
| 2 | \[e.g., Atlassian (JIRA Cloud)\] | Bug ticket storage | \[Region\] | \[SCCs / DPF / N/A\] |
| 3 | \[e.g., Linear\] | Issue tracking | US | \[SCCs / DPF / N/A\] |
| 4 | \[e.g., GitHub\] | Issue tracking | US | \[SCCs / DPF / N/A\] |
| 5 | \[e.g., Supabase / Postgres host\] | Feedback storage | \[Region\] | \[SCCs / DPF / N/A\] |
| 6 | \[e.g., AWS S3\] | Screenshot/voice object storage | \[Region\] | \[DPF / SCCs\] |
| 7 | \[e.g., Anthropic / OpenAI / Azure OpenAI / AWS Bedrock\] | Optional GenAI processing of feedback text | \[Region\] | \[SCCs / DPF\] |
| n | \[Add per actual deployment\] | | | |

**Note:** This list reflects the destinations Processor has configured in its snapfeed deployment. The snapfeed library itself is **not** a Sub-processor — it is open-source software the Processor self-hosts. The maintainers of snapfeed do not receive any Personal Data.

Processor will give Controller at least **30 days' prior notice** of changes to this list and provide Controller a right to object on reasonable grounds. If Controller objects and the Parties cannot agree on a remedy, Controller may terminate the affected Services without penalty.

---

## 6. Security measures

Processor implements appropriate technical and organizational measures including:

- Encryption in transit (TLS 1.2+) for the feedback ingress endpoint
- Encryption at rest at each Sub-processor
- Origin allowlisting and per-IP rate limiting on the ingress endpoint
- Server-side adapter credentials (no secrets in browser bundles)
- Pre-LLM redaction of emails, JWTs, credit-card-shaped numbers, and high-entropy tokens
- Console-error secret sweep before storage or dispatch
- Append-only audit log of feedback receipt, adapter dispatch, LLM calls, and rate-limit events
- Least-privilege access to the worker host; non-root container runtime
- Annual review of the snapfeed deployment configuration

The full list of library-level security controls is published at `SECURITY.md` in the snapfeed repository and is incorporated by reference.

---

## 7. Data Subject rights

Processor will assist Controller in responding to Data Subject Access Requests (DSARs) by:

- Locating Personal Data associated with a given Data Subject identifier across configured Sub-processor destinations
- Deleting or rectifying Personal Data on Controller's instruction
- Exporting Personal Data in a portable format

Controller acknowledges that Personal Data submitted via feedback may be replicated across multiple Sub-processor destinations (e.g. Slack message, JIRA ticket, Postgres row). Processor will execute deletion across all destinations within **30 days** of a verified request.

The snapfeed library includes `deleteByUserId()` for snapfeed-managed uploads/audit trails. Processor still maintains a manual deletion runbook for downstream systems such as Slack, JIRA, and email.

---

## 8. Audit rights

Controller may, at its own expense and no more than **once per calendar year** (and additionally following a Personal Data breach), audit Processor's compliance with this DPA. Audit may take the form of:

- A written questionnaire (preferred);
- Review of Processor's most recent third-party security report (e.g. SOC 2);
- An on-site audit on at least 30 days' written notice, conducted during business hours, with reasonable confidentiality undertakings.

Processor may satisfy audit requests by providing the snapfeed library audit log (`fileAuditLog` JSONL) for the period in question.

---

## 9. International data transfers

Where Personal Data of EEA, UK, or Swiss Data Subjects is transferred to a country not subject to an adequacy decision, the Parties agree that the SCCs (Module 2: Controller-to-Processor) are incorporated by reference and apply to the transfer. The optional clauses are filled in as follows:

- Clause 7 (Docking clause): \[applies / does not apply\]
- Clause 9 (Sub-processor authorization): General prior authorization with the 30-day notice procedure in §5
- Clause 11 (Redress): Independent dispute resolution body \[applies / does not apply\]
- Clause 17 (Governing law): \[Member State law\]
- Clause 18 (Forum): \[Member State court\]
- Annex I.A: Parties as identified in this DPA
- Annex I.B: Categories of data and Data Subjects as in §4
- Annex II: Security measures as in §6
- Annex III: Sub-processors as in §5

For UK transfers, the UK Addendum to the SCCs (issued by the ICO) applies.

For Swiss transfers, the SCCs apply with the modifications required by the Swiss FDPIC.

---

## 10. Liability and term

Each Party's liability under this DPA is subject to the limitations and exclusions set forth in the Master Services Agreement.

This DPA terminates automatically on termination or expiry of the Master Services Agreement. Sections that by their nature should survive (audit, deletion obligations, transfer obligations) survive termination.

---

## 11. Signature block

| | |
|---|---|
| **Controller** | **Processor** |
| Name: | Name: |
| Title: | Title: |
| Company: | Company: |
| Date: | Date: |
| Signature: | Signature: |

---

> **Reminder:** This template is provided as a starting point only. Have qualified privacy counsel review and adapt it to your specific deployment, jurisdiction, and customer relationships before signing.
