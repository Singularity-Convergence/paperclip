# Singularity Convergence Engineering SOPs

**Location:** `/datadrive/sc_vault/Shared_Services/Tech/Singularity_Convergence_Engineering_SOPs.md` (canonical SC vault copy); mirrored for PR-based review at `Singularity-Convergence/paperclip:doc/sc/singularity-convergence-engineering-sops.md`. The vault copy is the source of truth — the fork copy exists so SOP amendments can move through the standard Phase 3 (Stratos) / Phase 5 (Dokimos) review gates.
**Effective Date:** 2026-05-21
**Owner:** CTO (Connor Williams)
**Last Updated:** 2026-09-24 (rev 1.8 — Clarifies SOPs §5 + §Engineering PAT policy wording per SIN-2302 governance outcome (SIN-2284.7))

## Overview

This document defines the engineering lifecycle SOPs for Singularity Convergence subsidiary. All engineering work must pass through mandatory review gates where **Stratos Karras (Quality Challenger)** has review and veto authority.

## Agent Handoff Mechanism (MANDATORY — effective SIN-2292, rev 1.4)

**Authority:** CTO (Connor Williams).
**Trigger:** SIN-2292 — Chairman reported that `request_confirmation` interactions on SIN-2284.1 / SIN-2284.2 did not trigger a heartbeat for Stratos Karras. Forensics confirmed: **`request_confirmation.continuationPolicy: "wake_assignee"` wakes the *issue's* assignee AFTER the interaction is resolved — it does NOT wake the addressee of the interaction.** The Chairman had to manually create child issues assigned to Stratos to wake him. This was a missing-SOP failure, not a platform bug.

### What wakes an agent (Paperclip mechanics)

| Mechanism | Who wakes | When |
|---|---|---|
| Issue assignment (`assigneeAgentId: X` on create or PATCH) | The new assignee | Immediately on save (assignment heartbeat) |
| Reassignment of an existing issue to a different agent | The new assignee | Immediately on save |
| `@`-mention in a comment using the structured form `[@Agent Name](agent://<agent-id>)` | The mentioned agent | Immediately when the comment is posted (comment_mentioned wake) |
| Child issue creation with `parentId` + `assigneeAgentId: X` | The child assignee | Immediately on create |
| `request_confirmation` with `wake_assignee` | The **issue's** assignee (typically the requester) | **Only after** accept/reject — wakes them to act on the decision |
| `request_confirmation` with `wake_assignee_on_accept` | The **issue's** assignee | **Only after** accept |
| Issue monitor (`monitorNextCheckAt`) | The issue's assignee | At the scheduled time |

### What does NOT wake the addressee

- A `request_confirmation` addressed to Stratos, even with `wake_assignee`, **does not wake Stratos at creation time.** It only wakes the *issue's* assignee after Stratos responds. If you need Stratos to act, do not rely on the interaction alone.
- `request_checkbox_confirmation`, `request_item_verdicts`, `ask_user_questions`, `suggest_tasks` follow the same rule — they capture structured decisions; they do not wake the addressee by themselves.
- A plain comment (no `@`-mention, no assignment change) does not wake anyone.

### Required handoff pattern for every Engineering SOP phase gate

When a gate owner (Jordan Chen, Sophia Ergon, etc.) is ready to hand off to a reviewer (Stratos Karras, Dokimos Kridis), **all three of the following must be true**:

1. **@-mention the reviewer in the gate-filing comment** using the **structured `agent://` form only**:
   `[@Stratos Karras](agent://8d6036ef-5976-4c1d-a429-4f2b7cf62d43?i=shield)`
   This is what actually wakes the reviewer immediately.
2. **Create a `request_confirmation` interaction** on the same issue with `continuationPolicy: "wake_assignee"`, `resolverPolicy: "not_creator"`, `addresseeAgentId` set to the reviewer, and a deterministic `idempotencyKey` (`confirmation:<issueId>:phase<N>-<gate>`). This provides the typed decision capture, audit trail, and wakes the gate owner after the reviewer responds.
3. **PATCH the source issue to `in_review`** with `reviewInteractionId` set to the interaction id from step 2, and include the interaction link in the comment from step 1. This is the explicit waiting posture that keeps the parent from drifting into `in_progress` while waiting.

If any of steps 1, 2, or 3 is skipped, the handoff is non-conformant and a recovery loop may be needed.

### Deterministic @-mention form — correct vs. wrong (effective SIN-2298)

The first iteration of this SOP (rev 1.4) listed the structured form but agents repeatedly substituted UI-friendly URLs that **do not wake the addressee**. SIN-2288 (Phase 4 testing review) stalled for exactly this reason — the engineer used a `/SIN/agents/<name>` UI link instead of the `agent://<agent-id>?i=shield` form, so the reviewer was never woken. The mandatory rules are:

**Wrong (silently fails — reviewer is not woken):**
- `[@Stratos Karras](/SIN/agents/stratos-karras)` — UI URL link. Renders as a clickable agent name in the UI but does **not** generate a `comment_mentioned` wake.
- `[@Stratos Karras](@stratos-karras)` — bare `@` token. No wake target.
- `@Stratos Karras` plain text — no structured payload, no wake.
- `Stratos Karras please review.` — name only, no structured payload.

**Correct (deterministically wakes the reviewer):**
- `[@Stratos Karras](agent://8d6036ef-5976-4c1d-a429-4f2b7cf62d43?i=shield)` — structured `agent://` form with `?i=shield` flag. Paperclip's mention parser emits a `comment_mentioned` wake for the addressed agent on save.

**Universal recipe — substitute the right id for any reviewer:**

```text
[@<Reviewer Display Name>](agent://<reviewer-agent-id>?i=shield)
```

The `?i=shield` query string is the documented shield-flavored wake flag; omit it only when the platform spec for a particular interaction requires the unsuffixed form. Engineer agents MUST copy the exact id from `GET /api/agents` rather than guessing.

### Self-check after filing a gate (effective SIN-2298)

After posting the gate-filing comment and before the issue goes quiet, the gate owner MUST run the following verification in the **same heartbeat** the gate is filed:

1. `GET /api/agents/<reviewer-id>/inbox-lite` — confirm the source issue appears (or the reviewer has at least one `todo`/`in_progress`/`in_review` assignment from this handoff). If it does **not** appear within the same heartbeat, the wake did not land.
2. If step 1 fails, the gate is non-conformant. The gate owner MUST, in order:
   a. Edit the gate-filing comment to replace any wrong-form `@`-mention with the canonical `agent://<id>?i=shield` form, OR
   b. Fall back to a temporary reassignment: `PATCH /api/issues/{id}` with `assigneeAgentId: <reviewer-id>`, status `in_review`, and a comment naming the original gate owner + the gate that triggered the handoff. Reassignment back to the original assignee is the reviewer's first action after they accept/reject the gate.
3. Re-run step 1 to confirm the reviewer now sees the issue.

**Why this matters:** `request_confirmation.continuationPolicy: "wake_assignee"` wakes the *issue's* assignee (the gate owner) **after** the reviewer responds — it does **not** wake the reviewer at interaction creation. The `@`-mention is the only mechanism that wakes the reviewer immediately on filing. If the mention form is wrong, the gate sits unattended until a human notices or a watchdog fires.

### Forbidden handoff patterns

- **Manually creating a separate "Action on <issue>" issue assigned to the reviewer** to wake them. This bypasses the in-thread decision card, loses the structured audit trail, and leaves orphan issues. Use `@`-mention + `request_confirmation` instead.
- **Assuming `request_confirmation` wakes the addressee.** It does not.
- **Filing a gate without `@`-mentioning the reviewer.** The reviewer will not know to look at the issue.
- **Reassigning the source issue to the reviewer as the primary handoff mechanism.** Use `@`-mention first. Reassignment is acceptable **only** as the documented fallback when the `@`-mention self-check fails (see above), and must be accompanied by an explicit comment naming the original assignee and the gate that triggered the handoff so the reviewer can bounce the issue back on accept/reject.

## Dispatcher Discipline and Close-with-Pending-Downstream Prevention (effective SIN-2300, rev 1.7)

**Authority:** CTO (Connor Williams). Issued per [SIN-2300](/SIN/issues/SIN-2300) Chairman directive after the CTO closed [SIN-2298](/SIN/issues/SIN-2298) ("SOP handoff issues persist") as done 24 seconds after creating the child [SIN-2299](/SIN/issues/SIN-2299) — leaving Jordan Chen with a `todo` subtask, Sophia with the same stalled Phase 4 gate on [SIN-2288](/SIN/issues/SIN-2288), and no enforcement that the SOP fix would actually land.

**Why this section exists:** Closing a parent issue while a delegated child is still pending is a "fire-and-forget" pattern. It kills accountability: the close comment ("CTO scope on this issue is closed") is true only if the parent scope is independent of the child. When the parent's whole point is to make the child work — i.e. the parent delivered a process change and the child is the empirical application of that process change — the parent is NOT done until the child is done AND the new process is empirically validated end-to-end. A SOP edit that no one has actually applied against a real gate is a theoretical artifact, not a working rule.

### Rule 1 — No premature close with pending downstream

A parent issue **MUST NOT** be transitioned to `done` (or `cancelled`) while ANY of the following are still open:

- A direct child issue (`parentId = <self>`) with status `todo`, `in_progress`, `in_review`, or `blocked`.
- A `blocks` edge to an issue in `todo`, `in_progress`, or `in_review`.
- An open `request_confirmation` or `request_checkbox_confirmation` interaction on the parent itself.

The close MUST be deferred, OR the parent must be left in `in_review` / `in_progress` with an explicit `blockedByIssueIds` link to the child, until the downstream is resolved.

**Exception (Scope-boundary declaration):** if the parent scope is genuinely independent of the child (e.g. parent = "investigate and document the failure mode", child = "implement the SOP rule that prevents the failure mode"), the parent description MUST include a one-line **"Scope boundary"** declaration of the form:

```
Scope boundary: this issue covers <X>. The child <CHILD-ID> covers <Y>. The parent is considered done ONLY when <empirical artifact Z> is recorded on this thread.
```

A close comment that does not reference the scope boundary AND the empirical artifact is non-conformant under rev 1.7.

### Rule 2 — Validated fix requirement (process changes)

A parent whose deliverable is a **process change** — new SOP rule, new gate, new escalation path, new monitor — MUST NOT close as `done` until the new process has been **empirically validated end-to-end**. The validation MUST be:

1. **Triggered by the child issue** (`accept: true` on the request_confirmation in the child, OR a positive self-check report from the child assignee with empirical evidence in their own heartbeat).
2. **Recorded in the parent thread** as a comment with the validation evidence (a comment id from the child thread, a PR head sha, a reviewer acknowledgement, or a `GET /api/agents/<reviewer>/inbox-lite` snapshot).

For SOP changes specifically: validation is "have a reviewer apply the new rule against a real gate and confirm it works." A CTO close comment that says only "SOPs updated, child assigned, closing now" is non-conformant under rev 1.7 — that close comment is the failure mode SIN-2300 documents.

### Rule 3 — Dispatcher must wake + verify, not fire-and-forget

When a CTO (or any agent) creates a child issue as a delegated follow-up, the dispatcher MUST in the **same heartbeat**:

1. **Wake the child assignee** by posting a comment on the child that uses the structured `agent://<child-assignee-id>?i=shield` form to `@`-mention the assignee. (UI-link / bare `@` / plain text do not wake — see §Deterministic @-mention form above.)
2. **Create a `request_confirmation` on the child** addressed to the assignee with `continuationPolicy: "wake_assignee"`, `resolverPolicy: "not_creator"`, and a deterministic `idempotencyKey` of the form `confirmation:<child-id>:handoff:<rev>`.
3. **Run the self-check** `GET /api/agents/<child-assignee-id>/inbox-lite` in the same heartbeat and confirm the child appears in the assignee's queue. If it does not, repeat step 1 with the corrected form OR fall back to temporary reassignment per §Self-check after filing a gate.
4. **Either** schedule a follow-up monitor on the parent (or child) for long-running work, **OR** set `blockedByIssueIds: [<child-id>]` on the parent and leave the parent in `in_progress` / `in_review` until the child closes.

A dispatcher who only creates a child issue without steps 1–4 is in violation of rev 1.7.

### Rule 4 — Self-check the close decision

Before the dispatcher PATCHes the parent to `done` (or `cancelled`), the dispatcher MUST in the same heartbeat:

- `GET /api/issues/<parent-id>` with `include: children, blocks` (or rely on the in-memory `relatedWork.outbound` view) and verify all children and downstream blockers are `done` / `cancelled`.
- Verify no open `request_confirmation` / `request_checkbox_confirmation` interaction remains on the parent itself.
- If any open downstream exists, the dispatcher MUST either (a) keep the parent `in_progress` with `blockedByIssueIds: [<child-id>]`, or (b) explicitly justify the close in the comment with a **Scope-boundary** line AND the empirical-validation artifact required by Rule 2.

A close PATCH that violates Rule 4 without a Scope-boundary declaration is the textbook failure mode SIN-2300 documents.

### Forbidden close patterns (additive to §Forbidden handoff patterns)

- **Closing a parent issue within one full heartbeat cycle of creating the delegated child**, without empirical validation that the child is producing the desired outcome. The default expectation is the close happens in a heartbeat AFTER the child has produced at least one comment AND the child appears in the assignee's inbox-lite (per Rule 3 self-check). The 60-second minimum is the absolute floor, not the target.
- **"CTO scope closed" / "investigation complete, follow-up delegated"** as the SOLE close rationale when the follow-up is the point of the parent. The phrase is acceptable ONLY when accompanied by an explicit Scope-boundary declaration AND the empirical-validation artifact required by Rule 2.
- **Closing a parent that produced a process change without recording the empirical-validation step.** SOP changes that have not been tested against a real gate are theoretical.
- **Closing a parent while a directly-created child has `startedAt: null` (i.e. the child has not even been opened by its assignee).** If the child is `todo`, the parent close is non-conformant under Rule 1.

### Worked retro — what SIN-2298 should have done (rev 1.7 applied retroactively)

When the CTO close on [SIN-2298](/SIN/issues/SIN-2298) ("SOP handoff issues persist") fired at 2026-09-24T16:03:06Z, 24 seconds after creating the delegated child [SIN-2299](/SIN/issues/SIN-2299) at 2026-09-24T16:02:42Z, the sequence was:

| Step | Required (rev 1.7) | What happened | Verdict |
|------|---------------------|---------------|---------|
| 1. Child creation | `POST /api/issues` with `parentId`, `assigneeAgentId: <jordan>`, `blockedByIssueIds: [<upstream>]` | Done at 16:02:42 | ✓ |
| 2. Wake Jordan | Structured `[@Jordan Chen](agent://98233454-46bd-48f7-b83d-6cfa729356cb?i=shield)` mention on SIN-2299 in same heartbeat | Skipped | ✗ |
| 3. `request_confirmation` on SIN-2299 | Addressee = Jordan, `wake_assignee`, `not_creator`, idempotency key | Skipped | ✗ |
| 4. Self-check `GET /api/agents/<jordan>/inbox-lite` | Confirm SIN-2299 in Jordan's queue | Skipped | ✗ |
| 5. Empirical validation of SOP rev 1.6 | Have Jordan/Sophia/Stratos apply rev 1.6 against SIN-2288 and confirm it works | Not done — close comment said "SOPs hardened, follow-up delegated" | ✗ |
| 6. Parent close | After 1–5 verified | Done at 16:03:06, 24 seconds after step 1, no validation | ✗ |

Correct rev 1.7 sequence:

1. Create SIN-2299 (assigned to Jordan, blocked-by SIN-2288).
2. Wake Jordan: structured `agent://<jordan-id>?i=shield` mention on SIN-2299.
3. Create `request_confirmation` on SIN-2299 (addressee = Jordan, `wake_assignee`, `not_creator`).
4. Self-check: `GET /api/agents/<jordan-id>/inbox-lite` — confirm SIN-2299 in queue.
5. Keep SIN-2298 in `in_progress`, `blockedByIssueIds: [<SIN-2299-id>]`.
6. Wait for Jordan to dispatch the SOP rev 1.6 application: have Sophia post the corrected `agent://<stratos-id>?i=shield` mention on SIN-2288, self-check Stratos's inbox-lite, advance to Phase 5.
7. Close SIN-2298 only AFTER empirical evidence lands on SIN-2288 that the gate was unblocked end-to-end with the new SOP form.

### Reference

- Trigger: [SIN-2300](/SIN/issues/SIN-2300) Chairman complaint
- Parent: [SIN-2298](/SIN/issues/SIN-2298) (closed prematurely; the empirical-validation retro is recorded on SIN-2300)
- Child: [SIN-2299](/SIN/issues/SIN-2299) (Jordan Chen, blocked-by SIN-2288 — blocker to be re-evaluated per rev 1.7 since SIN-2299 acceptance criteria do not require SIN-2288 to be in any specific state)
- Upstream: [SIN-2288](/SIN/issues/SIN-2288) (Phase 4 testing review; the gate that motivated SOP rev 1.6)

### Example: filing a Phase 2 design review for Stratos

```text
1. Comment on SIN-2284.2 (the Phase 2 issue):
   ## Phase 2 — Design Review filed
   [@Stratos Karras](agent://8d6036ef-5976-4c1d-a429-4f2b7cf62d43?i=shield)
   please review sections §1..§12 below.
   [request_confirmation 21e999ea-... — link]

2. POST /api/issues/SIN-2284.2/interactions
   { kind: "request_confirmation",
     addresseeAgentId: "<stratos-agent-id>",
     resolverPolicy: "not_creator",
     continuationPolicy: "wake_assignee",
     idempotencyKey: "confirmation:SIN-2284.2:phase2-design:<rev>",
     payload: { ... } }

3. PATCH /api/issues/SIN-2284.2
   { status: "in_review",
     reviewInteractionId: "<interaction-id-from-step-2>",
     comment: "Filed Phase 2 design review; awaiting Stratos sign-off (interaction <id>)." }

4. SELF-CHECK (same heartbeat):
   GET /api/agents/<stratos-agent-id>/inbox-lite
   → confirm SIN-2284.2 (or any new todo / in_progress / in_review entry for that agent) appears.
   → If empty, replace the wrong-form mention in step 1 and re-PATCH, OR fall back to temporary reassignment with a comment naming the original assignee.
```

All four steps in the same heartbeat. No follow-up "Action on SIN-2284.X" issue needed.

## Agents Subject to These SOPs

| Agent | Role |
|-------|------|
| Connor Williams | CTO - engineering oversight |
| Jordan Chen | SC Lead - engineering lead |
| Stratos Karras | Quality Challenger - quality review/veto |
| Sophia Ergon | Engineer - implementation |
| Dokimos Kridis | Validation Agent - statistical validation |

## Engineering Lifecycle Phases

**Every phase gate handoff MUST follow the [Agent Handoff Mechanism (MANDATORY)](#agent-handoff-mechanism-mandatory--effective-sin-2292-rev-14):** file a gate comment that `@`-mentions the reviewer, create a `request_confirmation` interaction with `wake_assignee`, and PATCH the source issue to `in_review` with `reviewInteractionId`. Skipping any step is a SOP violation.

### Phase 1: Requirements Review

**Owner:** Jordan Chen (SC Lead)

**Required Actions:**
- [ ] Requirements documented in issue/PRD
- [ ] Security and safety requirements identified
- [ ] Autonomy stage requirements specified (Stage 0-3)
- [ ] Memory firewall requirements defined

**Stratos Karras Review Gate:**
- [ ] Requirements do not violate safety thresholds
- [ ] Quality metrics are measurable and defined
- [ ] Veto authority acknowledged

**Exit Criteria:** Stratos Karras sign-off required before proceeding to Design

---

### Phase 2: Design Review

**Owner:** Jordan Chen (SC Lead)

**Required Actions:**
- [ ] Architecture design documented
- [ ] Build vs buy analysis completed
- [ ] Security threat model reviewed
- [ ] Autonomy governance plan defined (Stage promotion gates)

**Stratos Karras Review Gate:**
- [ ] Design meets defined quality thresholds
- [ ] No safety or security vulnerabilities identified
- [ ] Challenger review documented

**Exit Criteria:** Stratos Karras sign-off required before implementation

---

### Phase 3: Implementation Review

**Owner:** Sophia Ergon (Engineer)

**Required Actions:**
- [ ] Code implemented per design spec
- [ ] Secrets management via environment variables
- [ ] Memory firewall compliance verified
- [ ] Kill switch integration confirmed
- [ ] **GitHub PR created and linked to issue**

**Stratos Karras Review Gate:**
- [ ] Code passes quality threshold review
- [ ] No autonomy drift detected
- [ ] Security controls implemented correctly
- [ ] **PR approved by Stratos Karras**

**Exit Criteria:** Stratos Karras sign-off on PR required before testing

---

### Phase 4: Testing Review

**Owner:** Sophia Ergon (Engineer)

**Required Actions:**
- [ ] Unit tests pass (n >= 30 for accuracy metrics)
- [ ] Integration tests pass
- [ ] Autonomy governance validation (accuracy at required threshold)
- [ ] Performance benchmarks met

**Stratos Karras Review Gate:**
- [ ] Test coverage meets quality thresholds
- [ ] Autonomy accuracy verified at required n (30/50/100)
- [ ] Quality metrics documented

**Exit Criteria:** Stratos Karras sign-off required before release

---

### Phase 5: Release Review

**Owner:** Jordan Chen (SC Lead)

**Required Actions:**
- [ ] Staging environment validation complete
- [ ] Vault data promotion SOP followed (if applicable)
- [ ] Rollback plan documented
- [ ] Monitoring and alerts configured
- [ ] **PR merged to main branch**

**Stratos Karras Review Gate:**
- [ ] Final quality assessment approved
- [ ] No outstanding quality vetoes
- [ ] Release readiness confirmed
- [ ] **Merge commit verified by Stratos**

**Exit Criteria:** Stratos Karras explicit release approval + PR merged

---

## Quality Challenger Veto Authority

Stratos Karras (Quality Challenger) has **veto authority** at each phase gate. If Stratos issues a quality veto:

1. Work stops at that phase
2. SC Lead (Jordan Chen) must address veto concerns
3. Re-review required before proceeding
4. If veto cannot be resolved, escalate to CTO (Connor Williams)

## Dokimos Kridis in Phase Gates

Dokimos Kridis (Validation Agent) provides statistical validation at each phase gate. Dokimos confirms accuracy metrics meet required thresholds at proper sample sizes before phase progression.

| Phase | Role |
|-------|-------------|
| Phase 1 (Requirements) | Validate requirements are measurable and testable at required sample sizes |
| Phase 2 (Design) | Validate design assumptions have supporting evidence |
| Phase 3 (Implementation) | Validate implementation metrics meet thresholds |
| Phase 4 (Testing) | Validate accuracy metrics at n>=30/50/100 per stage |
| Phase 5 (Release) | Final statistical sign-off before release |

**Note:** Dokimos provides quantitative backing; Stratos retains veto authority.

## Stage Autonomy Governance

Per SHIELD.md, autonomy promotion requires:

| Stage | Accuracy Requirement | Min Samples |
|-------|---------------------|-------------|
| Stage 0 | N/A | N/A |
| Stage 1 | 95% | n >= 30 |
| Stage 2 | 98% | n >= 50 |
| Stage 3 | 99.5% | n >= 100 |

**Stage promotion requires Stratos Karras validation before CTO/Chairman approval.**

## Cross-Subsidiary Data Flows

Any cross-subsidiary data flow requires:
1. Chairman approval per item AND per pattern
2. Memory firewall compliance verification
3. Documentation in SHIELD.md

## Shared Technology Services

Singularity Convergence is the technology services subsidiary for all Singularity Convergence Group subsidiaries. When building technology solutions:

1. **Abstraction First:** Design solutions with abstraction layers to enable cross-subsidiary reuse
2. **Reusability:** Where feasible, technology components should be reusable by Singularity Convergence, WildPath Parks, Recurv, and Alpha Arc Capital
3. **External Customers:** Technology services may also extend to external customers with proper approval
4. **Routing:** Non-technology work for other subsidiaries should be escalated to the appropriate subsidiary lead via CEO

## GitHub Repository Standards

**All engineering code MUST be committed to a GitHub organization.**

### Repository Organization Decision Tree

**Step 1: Determine the correct GitHub organization**

```
Is the solution a SHARED SERVICE used by multiple subsidiaries?
├── YES → Go to Step 2a (Shared Services Path)
└── NO  → Go to Step 2b (Subsidiary-Specific Path)
```

**Step 2a: Shared Services Organization (Cross-Subsidiary)**
- **Organization:** `singularity-convergence` GitHub organization
- **Repository naming:** `sc-<solution-name>` (e.g., `sc-paperclip-plugin-telegram`, `sc-vault-sync`)
- **Access:** Jordan Chen and Sophia Ergon as maintainers; Stratos Karras as reviewer
- **Examples:**
  - Shared messaging infrastructure
  - Cross-subsidiary authentication/authorization
  - Shared vault/data synchronization services
  - Paperclip plugin infrastructure

**Step 2b: Subsidiary-Specific Organization**
Choose the appropriate subsidiary organization:

| Subsidiary | GitHub Organization | Repository Naming |
|------------|-------------------|------------------|
| WildPath Parks | `wildpath-parks` | `<solution-name>` |
| Recurv | `recurv` | `<solution-name>` |
| Alpha Arc Capital | `alpha-arc-capital` | `<solution-name>` |

**Examples of subsidiary-specific solutions:**
- WildPath Parks: RV park booking system, property management
- Recurv: Resale inventory management, buyer-seller matching
- Alpha Arc Capital: Market analysis tools, trading infrastructure

### Repository Creation SOP

**Owner:** Jordan Chen (SC Lead) — has repo creation authority

**For Shared Services (singularity-convergence org):**
1. Jordan Chen creates repo under `singularity-convergence` organization
2. Set branch protection: main requires PR + Stratos Karras review
3. Add maintainers: Jordan Chen, Sophia Ergon
4. Add reviewer: Stratos Karras
5. Document repo creation in the related SIN issue

**For Subsidiary-Specific (corresponding org):**
1. Jordan Chen coordinates with subsidiary lead to create repo
2. Subsidiary lead becomes repo admin
3. SC Lead (Jordan Chen) added as maintainer for shared services involvement
4. Branch protection per subsidiary standards (at minimum: PR + subsidiary tech lead review)

### Repository Per Solution

**Rule:** Each distinct technology solution MUST have its own repository.

Examples:
- ✅ `sc-paperclip-plugin-telegram` — Telegram integration plugin
- ✅ `sc-vault-sync` — Vault synchronization service
- ✅ `wildpath-parks/booking-engine` — RV park booking system
- ✅ `recurv/inventory-tracker` — Resale inventory management

Anti-patterns (NEVER do):
- ❌ Single repo for multiple unrelated solutions
- ❌ Monorepo containing code for multiple subsidiaries without clear abstraction boundaries

### Branch Protection Rules

**All repositories MUST enforce branch protection on main branch:**

| Organization Type | Required Reviewers | Force Push | Direct Commits |
|------------------|-------------------|------------|----------------|
| Shared Services (sc-*) | Stratos Karras (required) + 1 maintainer | Blocked | Blocked |
| Subsidiary-Specific | Subsidiary tech lead (required) + 1 additional | Blocked | Blocked |

### Commit Standards

1. **Every feature/bugfix = one commit**
2. **Commit message format:** `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
   - Example: `feat(telegram): add freeform messaging relay`
3. **Co-author required:** Every commit MUST include:
   ```
   Co-Authored-By: Paperclip <noreply@paperclip.ing>
   ```
4. **PR Requirements:**
   - PR title matches commit format
   - Description links to relevant issue (e.g., "Fixes SIN-1257")
   - Required reviewer approval before merge

### Engineering Team GitHub Access

| Agent | Role | Shared Services (sc-*) | Subsidiary Repos |
|-------|------|------------------------|------------------|
| Jordan Chen | SC Lead / Maintainer | Maintain + repo creation | Maintain |
| Sophia Ergon | Engineer / Maintainer | Maintain | Write |
| Stratos Karras | Reviewer | Read + required reviewer | Read + required reviewer |

### Phase Integration

**Phase 3 GitHub Requirement:**
- [ ] GitHub PR created and linked to issue
- [ ] PR passes required reviewer(s)
- **Exit gate:** Required reviewer approval = implementation gate passed

**Phase 5 GitHub Requirement:**
- [ ] PR merged to main branch
- [ ] Merge commit verified
- **Exit gate:** Merge confirmation = release gate passed

## Paperclip Repository Workflow (MANDATORY — effective SIN-2294, rev 1.5; clarified §5 + §Engineering PAT policy rev 1.8)

**Authority:** CTO (Connor Williams). Issued per [SIN-2294](/SIN/issues/SIN-2294) Chairman directive. Replaces any prior wording in §Repository Organization Decision Tree that pointed Phase 3 PRs at `paperclipai/paperclip` directly. §Bug fix workflow step 5 wording and §Engineering PAT policy second-bullet wording amended per [SIN-2284.7](/SIN/issues/SIN-2284.7) / [SIN-2305](/SIN/issues/SIN-2305) — see Document Control row 1.8 for the trigger (a Sophia Ergon empirical verification on [SIN-2302](/SIN/issues/SIN-2302) comment `59a6a3ce` showing the previous wording was a structural dead-end).

**Why this section exists:** Singularity Convergence runs on the upstream Paperclip platform (`paperclipai/paperclip`). We **never** receive direct write access to the upstream repository — that is permanent, not an oversight. All SC engineering work on Paperclip code must therefore flow through our fork, with cross-fork contribution to upstream as a separate, downstream step.

### Canonical repositories

| Role | Repo | SC write access |
|------|------|------------------|
| Upstream Paperclip (read-only reference + PR target) | `https://github.com/paperclipai/paperclip.git` | None. SC agents hold only `pull` permission. |
| SC Paperclip fork (canonical working copy) | `https://github.com/Singularity-Convergence/paperclip.git` | All SC engineering PATs. Sophia, Jordan, Stratos, Dokimos PATs are scoped to `Singularity-Convergence/*` only. |

### Engineering PAT policy

- All SC engineering PATs **MUST** be fine-grained, scoped to `Singularity-Convergence/*` repositories, with `Contents: Read and write` + `Pull requests: Read and write`.
- **No** SC engineering PAT is ever scoped to `paperclipai/paperclip` with write permission. Cross-fork PRs to upstream are issued via GitHub's standard cross-fork compare API and accepted by upstream maintainers — SC is the contributor, not the merger.
- **Cross-fork upstream PRs opened from a GitHub web-UI compare flow by a human contributor signed in with push access to the SC fork do not require any PAT change — the web-UI compare flow authenticates with the user's identity, not a token. REST-API path requires upstream write scope and falls under the CTO exception rule.** (rev 1.8 — added to resolve the [SIN-2284.7](/SIN/issues/SIN-2284.7) dead-end where step 5 of the previous bug-fix workflow said cross-fork PRs do not require upstream write access, which is false for the REST API path an SC agent would otherwise use.)
- The previous "widening the PAT to write to upstream" unblock path (e.g. [SIN-2293](/SIN/issues/SIN-2293)) is **obsolete** under this policy and must be cancelled / redirected whenever it appears, unless explicitly reissued by the CTO as a one-off time-bounded PAT exception per the bug-fix workflow alternatives (step 5).

### Bug fix workflow (Phase 3 + 5)

For a Phase 3 PR involving Paperclip core code:

1. Branch off `Singularity-Convergence/paperclip:master`. Never branch off `paperclipai/paperclip:master` directly (you have no credentials to push there anyway).
2. Implement + commit per the existing §Commit Standards.
3. Open the PR against `Singularity-Convergence/paperclip:master` (the SC fork is the base repo). This is the **durable review surface** for Stratos Karras's PR approval. PR body references `Fixes SIN-<n>` per the existing rule.
4. Phase 5 (Release) merges the PR into the SC fork master.
5. **After the SC-side merge, open the cross-fork PR via the GitHub web-UI compare flow at `https://github.com/paperclipai/paperclip/compare/master...Singularity-Convergence:<branch>?expand=1`, signed in with a GitHub identity that has push access to `Singularity-Convergence/paperclip`. Agents without a browser session cannot open this PR; it is a downstream human-in-the-loop step. REST-API creation requires write access on the upstream repo and is forbidden to SC engineering agents. Practical alternatives for an agent-only cycle are (a) a CTO-issued one-off time-bounded PAT exception, or (b) defer per step 6; both are governance decisions.** (rev 1.8 wording — replaces the rev 1.5 sentence "cross-fork PRs do not require write access on the upstream repo", which was false for the REST API path and created a structural dead-end under §Engineering PAT policy above.)
6. Phase 5 gate validates **both** the SC-fork merge commit **and** the upstream cross-fork PR link. The release is not "done for upstream" until the upstream PR is opened; if upstream rejects the contribution, file a follow-up tracking issue rather than blocking the SC-side release.

### Triage rules: bug fix vs. extension vs. new feature

| Work type | Where it lives | Upstream PR? |
|-----------|----------------|--------------|
| **Bug fix** in existing Paperclip core behavior | SC fork | Yes — after SC-merge. |
| **SC-specific extension** that does not benefit other Paperclip users | SC fork | No. SC-only is acceptable; gate the Phase 5 PR merge without an upstream PR. |
| **New feature** relevant to all Paperclip users | Discuss with upstream maintainers **before** opening the cross-fork PR; they may want a design conversation first. | Conditional on maintainer signal. |
| **Customization of Paperclip UI / business logic for SC workflows** | Prefer the **extensibility modules** below over a core edit. | Usually no. |

### Phase gating integration

- **Phase 2 (Design)** MUST document the chosen path (SC-only fork / cross-fork upstream / extensibility module) and the rationale.
- **Phase 3 (Implementation)** Stratos Karras review MUST verify the PR base repo is `Singularity-Convergence/paperclip`, not `paperclipai/paperclip`.
- **Phase 5 (Release)** Stratos Karras explicit approval MUST cover both the SC-fork merge and (when applicable) the upstream cross-fork PR link. If a "core edit" choice conflicts with the extensibility module decision matrix below, the SOPs win and the issue returns to Phase 2 for redesign.

## Paperclip Extensibility Modules (MANDATORY — effective SIN-2294, rev 1.5)

**Authority:** CTO (Connor Williams). Issued per [SIN-2294](/SIN/issues/SIN-2294) Chairman directive: "we should only do it via extendable modules supported by Paperclip, so that we don't have to touch the base code, and are always in sync with the upstream repo."

### Why this section exists

Once the SC fork is the canonical working copy of Paperclip code, the fork is still **base code we are forking** — every manual edit there carries merge-conflict and drift risk against the upstream. The platform exposes four first-class extensibility surfaces designed exactly so that SC can add behavior without forking or back-porting:

| Surface | When to use | When **not** to use |
|---------|-------------|----------------------|
| **Plugin** (`paperclipai plugin init`; see `paperclip-create-plugin` skill) | Self-contained server-side capability — new adapter, MCP server, scheduled worker, external integration, internal API. Lives **outside** the Paperclip checkout entirely. | The change is a defect in Paperclip core, or it is a new platform-wide feature the upstream maintainers must accept first. |
| **Tool** (per-agent via `POST /api/agents/me/tools` or adapter `tools.list`) | A capability exposed to a single agent's LLM (HTTP fetch, DB query, scoped action). | Multiple agents need it — wrap the tool in a plugin and expose to each via `addressedAgentId` instead. |
| **Skill** (per-agent via `POST /api/agents/{id}/skills/sync`, or company-wide via the company skills API) | Reusable procedural knowledge — SOPs, runbooks, prompt context — that every heartbeat of an agent can load on demand. Skills are **instructions, not code**. | Runtime behavior that needs to call a tool or make network requests. Use a plugin or tool. |
| **Decision** (`POST /api/companies/{id}/decisions` or `decision-bundles`) | Auditable cross-issue choice with structured options + effects; one decision card instead of a chain of comments. | One-off coordination on a single issue — use `request_confirmation` instead. |
| **Routine** (`POST /api/companies/{id}/routines` with cron/webhook/api triggers) | Recurring heartbeat-quality work — daily plan checks, weekly audits, scheduled validators. | One-shot work. |

### Extension decision rule (per heartbeat)

Before opening a Phase 3 PR against `Singularity-Convergence/paperclip:master`, the engineer (Sophia Ergon) and the SC Lead (Jordan Chen) must walk this ladder and pick the lightest surface that fits:

1. **Instructions only?** → Skill. Author/assign via `POST /api/agents/{id}/skills/sync`.
2. **LLM-callable function for one agent?** → Tool on that agent.
3. **LLM-callable function used by multiple agents?** → Plugin that exposes the tool; install once per Paperclip instance.
4. **Scheduled recurring execution by an agent?** → Routine (auto-creates per-fire execution issues).
5. **Cross-issue auditable choice?** → Decision bundle.
6. **MCP / external IO / new server-side endpoint?** → Plugin.
7. **None of the above, and the change is genuinely a Paperclip core defect?** → Bug-fix workflow above (fork + cross-fork upstream PR).

The Phase 1 Requirements Review and the Phase 2 Design Review **must** capture the chosen surface and rejection rationale for the lighter alternatives. Stratos Karras's gate review must verify the lightest viable surface was picked.

### Authoritative references

- Plugin authoring workflow: `/home/dennisg/.claude/skills/paperclip-create-plugin/SKILL.md` — load this when scaffolding a new plugin.
- Platform skills + interaction kinds: `/home/dennisg/.claude/skills/paperclip/SKILL.md` and its `references/api-reference.md`.
- SOP integration with `paperclip-converting-plans-to-tasks` (decision → task graph): see the same skill tree.

## Document Control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 2026-05-21 | Connor Williams | Initial version per SIN-474 |
| 1.1 | 2026-05-22 | Connor Williams | Added Dokimos Kridis to Agents table per SIN-723 |
| 1.1 | 2026-05-22 | Alexandra Stone | Added Dokimos Kridis to agents table and phase gates per SIN-713 |
| 1.2 | 2026-05-27 | Connor Williams | Added GitHub repository standards per Chairman directive |
| 1.3 | 2026-05-27 | Connor Williams | Revised GitHub org decision tree per Chairman: shared services vs subsidiary-specific path |
| 1.4 | 2026-09-24 | Connor Williams | Added **Agent Handoff Mechanism (MANDATORY)** section per SIN-2292. Codifies the `@`-mention + `request_confirmation` + `in_review` three-step pattern after the Chairman reported that `request_confirmation` alone did not wake Stratos Karras. Forensics: `wake_assignee` wakes the issue's assignee, not the addressee. |
| 1.5 | 2026-09-24 | Connor Williams | Added **Paperclip Repository Workflow** + **Paperclip Extensibility Modules** sections per [SIN-2294](/SIN/issues/SIN-2294) Chairman directive. Codifies the fork-first / cross-fork-upstream PR pattern, scopes all engineering PATs to `Singularity-Convergence/*` only, and mandates extensibility surfaces (plugin / tool / skill / decision / routine) as the default for any new capability, with core edits reserved for genuine Paperclip defects. |
| 1.6 | 2026-09-24 | Connor Williams | Hardened **Agent Handoff Mechanism** per [SIN-2298](/SIN/issues/SIN-2298) — explicit wrong/correct @-mention forms (UI-link vs `agent://<id>?i=shield`), mandatory self-check via `GET /api/agents/<reviewer-id>/inbox-lite` immediately after filing, and a documented reassignment fallback when the self-check fails. Trigger: [SIN-2288](/SIN/issues/SIN-2288) (Phase 4 testing review) stalled because the engineer used a `/SIN/agents/<name>` UI link instead of the `agent://` form — the reviewer was never woken and the gate sat unattended. |
| 1.7 | 2026-09-24 | Connor Williams | Added **Dispatcher Discipline and Close-with-Pending-Downstream Prevention** per [SIN-2300](/SIN/issues/SIN-2300) Chairman directive. Rule 1: no close while a child / downstream / open interaction is open unless a Scope-boundary declaration is recorded. Rule 2: process changes (SOP edits, new gates) require empirical end-to-end validation before parent close. Rule 3: dispatcher must wake + verify + self-check + monitor/block in the same heartbeat the child is created. Rule 4: explicit close-decision self-check against `relatedWork.outbound`. Worked retro on SIN-2298 (parent closed 24 seconds after child creation with no wake, no self-check, no validation). Trigger: SIN-2298 close fired 24 seconds after creating SIN-2299 with no wake, no self-check, no empirical validation. Closing a parent while a delegated child is pending is a fire-and-forget pattern that defeats delegation accountability. |
| 1.8 | 2026-09-24 | Connor Williams | Clarified **Paperclip Repository Workflow** §5 (Bug fix workflow) and §Engineering PAT policy per [SIN-2284.7](/SIN/issues/SIN-2284.7) / [SIN-2305](/SIN/issues/SIN-2305). Trigger: Sophia Ergon empirical verification on [SIN-2302](/SIN/issues/SIN-2302) comment `59a6a3ce` that GitHub's REST API requires write access on the upstream repo to POST a cross-fork PR — the previous wording "cross-fork PRs do not require write access on the upstream repo" was false for the REST API path and created a structural dead-end under the engineering PAT policy. The web-UI compare flow is the only path that authenticates with the user's GitHub identity (no PAT change required) and is the documented SC procedure; REST-API creation remains forbidden to SC engineering agents unless the CTO issues a one-off time-bounded PAT exception. Future cross-fork PR attempts can now be resolved by an engineer reading this section alone, without escalation. |
