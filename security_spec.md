# CampusPatrol Security Specification (Two-Tier Google-Only RBAC)

## 1. Data Invariants
1. **Google-Only Verified Identity**: Every read or write requires `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.token.firebase.sign_in_provider == 'google.com'`.
2. **Active Allowlist Enforcement (`allowedAccounts`)**: Only the bootstrapped admin (`mihsia@gmail.com`) or Google accounts explicitly registered in `/allowedAccounts/{emailKey}` with `status == 'active'` and exact lowercase `email` match may access operational school collections (`staffProfiles`, `timetables`, `leaveRecords`, `patrolLogs`, `absences`, `incidents`).
3. **Instant Revocation**: Setting `allowedAccounts/{emailKey}.status = 'disabled'` immediately revokes both `isAuthorizedAccount()` and `isAdmin()` synchronously at the Firestore Rules layer.
4. **Two-Tier Role Integrity (`admin` | `user`)**: Only `admin` may create/edit/disable/delete `/allowedAccounts`, write/delete `/timetables`, delete `/incidents`, or override resolved incidents. Regular `user` accounts can never escalate `role` or `status`.
5. **Bootstrap Admin Protection**: `mihsia@gmail.com` can never be demoted, disabled, or deleted.
6. **PII Isolation**: `/allowedAccounts` (containing staff emails) and `/userPrivate` are strictly restricted: regular users may `get` ONLY their own document and can NEVER `list` other users' emails. Only `admin` may list `/allowedAccounts`.
7. **Anti-Orphan Relational Checks**: Creating `patrolLogs` or `absences` requires `exists(/databases/$(database)/documents/timetables/$(incoming().timetableId))`.
8. **Terminal State Lock**: Resolved incidents (`status == 'resolved'`) cannot be modified by non-admins.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified / Non-Google Provider Spoof**: Authenticated user with `sign_in_provider: 'password'` or `email_verified: false` attempts to read `timetables` -> `PERMISSION_DENIED`.
2. **Unauthorized Stranger Google Login**: Verified Google account `stranger@gmail.com` (not in `allowedAccounts`) attempts to read `patrolLogs` or create `staffProfiles` -> `PERMISSION_DENIED`.
3. **Disabled Account Write**: Previously authorized account whose `allowedAccounts` doc has `status: 'disabled'` attempts to log a patrol -> `PERMISSION_DENIED`.
4. **Self-Role Escalation on AllowedAccount**: Active `user` attempts to update own `allowedAccounts/{emailKey}` with `{ role: 'admin' }` -> `PERMISSION_DENIED`.
5. **Self-Status Reactivation**: Disabled user attempts to update own `allowedAccounts/{emailKey}` with `{ status: 'active' }` -> `PERMISSION_DENIED`.
6. **PII Directory Scraping**: Regular `user` attempts `list` on `/allowedAccounts` or `get` on another user's `/allowedAccounts/{otherKey}` -> `PERMISSION_DENIED`.
7. **Shadow Ghost Field Injection**: Admin or user sends `{ ..., isSuperAdmin: true }` when creating/updating `allowedAccounts` -> `PERMISSION_DENIED`.
8. **Regular User Timetable Tampering**: Active `user` (non-admin) attempts to create or delete a `/timetables/{id}` slot -> `PERMISSION_DENIED`.
9. **Bootstrap Admin Lockout Attack**: Another admin attempts to disable or delete `allowedAccounts/mihsia_gmail_com` -> `PERMISSION_DENIED`.
10. **Path ID Poisoning**: Creating `/allowedAccounts/bad!email@id` or mismatched key vs email -> `PERMISSION_DENIED`.
11. **Orphaned Patrol Log**: Creating `/patrolLogs/{id}` referencing nonexistent `timetableId` -> `PERMISSION_DENIED`.
12. **Resolved Incident Reopen by Non-Admin**: Active `user` attempts to mutate `incidents/{id}` after `status == 'resolved'` -> `PERMISSION_DENIED`.
