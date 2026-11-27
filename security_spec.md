# CampusPatrol Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Verified Identity Gate**: Every read and write operation requires `request.auth != null && request.auth.token.email_verified == true`. Unverified emails (including spoofed admin emails) are unconditionally rejected.
2. **PII Isolation**: User email addresses are stored exclusively in `/userPrivate/{userId}`, readable and writable only by the owner (`request.auth.uid == userId`) or an administrator (`isAdmin()`). Public `/staffProfiles/{userId}` documents contain zero PII.
3. **No Self-Assigned Privileges**: Non-admin users creating `/staffProfiles/{userId}` may only register with `role == 'inspector'` and can never mutate `role` during updates. Only admins can write to `/admins/{userId}` or change a user's `role`.
4. **Relational Integrity (Anti-Orphan)**: Every `/patrolLogs/{logId}` and `/absences/{absenceId}` document must reference an existing `/timetables/{timetableId}` document verified via `exists()` at creation time. Every `/incidents/{incidentId}` with a non-empty `timetableId` must also verify `exists()`.
5. **Temporal Integrity & Immutability**: `createdAt` must equal `request.time` on creation and remain immutable on update. `updatedAt` must equal `request.time` on update. Creator/owner identity fields (`uid`, `createdBy`, `inspectorId`, `recordedBy`, `reporterId`) are immutable after creation.
6. **Terminal State Locking**: Once an `/incidents/{incidentId}` document reaches `status == 'resolved'`, non-admin users cannot modify it further. Admins retain an explicit override gate.
7. **Action-Based Updates & Strict Keys**: Every write passes a dedicated `isValid[Entity]()` schema blueprint enforcing `hasAll`/`hasOnly`, strict types, string `.size()` caps, bounded array sizes, and regex ID guards (`^[a-zA-Z0-9_\-]+$`). Every update uses `affectedKeys().hasOnly(...)`.
8. **Secure List Queries**: No blanket `allow list: if isSignedIn();`. Every `allow list` validates `resource.data` directly (`resource.data.campusId == 'main-campus'` for shared campus data; `resource.data.uid == request.auth.uid` for private records) with zero `get()`/`exists()` inside `allow list`.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Collection | Malicious Payload / Context | Expected Result |
|---|---------------|------------|-----------------------------|-----------------|
| 1 | Unverified Admin Email Spoof | `/admins/attacker` | `email: 'mihsia@gmail.com', email_verified: false` | `PERMISSION_DENIED` |
| 2 | Self-Assigned Admin Role | `/staffProfiles/userA` | `{ role: 'admin', ... }` created by non-admin `userA` | `PERMISSION_DENIED` |
| 3 | Role Escalation via Update | `/staffProfiles/userA` | `userA` updates own profile `{ role: 'admin', updatedAt: serverTimestamp() }` | `PERMISSION_DENIED` |
| 4 | Cross-User PII Read | `/userPrivate/userB` | `userA` attempts `get` on `userB`'s private email doc | `PERMISSION_DENIED` |
| 5 | Ghost / Shadow Field Injection | `/patrolLogs/log-1` | Valid patrol log plus extra `{ isVerifiedByPrincipal: true }` | `PERMISSION_DENIED` |
| 6 | Client Timestamp Backdating | `/patrolLogs/log-2` | `{ createdAt: Timestamp(2020-01-01), ... }` | `PERMISSION_DENIED` |
| 7 | Orphaned Patrol Log | `/patrolLogs/log-3` | `{ timetableId: 'nonexistent-slot-999', ... }` | `PERMISSION_DENIED` |
| 8 | Path ID Poisoning | `/timetables/bad id!@#...` | Document ID containing spaces/symbols or >128 chars | `PERMISSION_DENIED` |
| 9 | Identity Spoofing | `/incidents/inc-1` | `userA` creates incident with `reporterId: 'userB'` | `PERMISSION_DENIED` |
| 10 | Terminal State Tampering | `/incidents/inc-resolved` | Non-admin updates an already `resolved` incident back to `open` | `PERMISSION_DENIED` |
| 11 | Value Poisoning (Oversized String) | `/incidents/inc-2` | Updating `resolutionNote` with a 50,000-character string | `PERMISSION_DENIED` |
| 12 | Unbounded Roster Array DoS | `/timetables/tt-1` | Creating timetable slot with 200 items in `roster` array (>60 limit) | `PERMISSION_DENIED` |
