# Security Specification — CyberGameStore Admin & Storefront

## 1. Data Invariants

1. **Public Catalog, Admin-Only Catalog Mutations**: Any storefront visitor may read `/products/{productId}` (contains zero PII). Creating, updating, or deleting products is strictly limited to verified administrators (`request.auth.token.email_verified == true` and bootstrapped admin `rean4er@gmail.com` or UID present in `/admins/{uid}`).
2. **Strict PII & Sales Isolation**: `/sales/{saleId}` contains customer names, contacts, and financial revenue metrics. Unauthenticated and non-admin authenticated users are strictly denied `get`, `list`, `create`, `update`, and `delete`.
3. **Immutable Ownership & Timestamps**: `createdBy` must equal `request.auth.uid` on create and remain immutable on update. `createdAt` must equal `request.time` on create and remain immutable on update. `updatedAt` must equal `request.time` on both create and update.
4. **Strict Payload Boundaries & Anti-Shadow Fields**: Every document write validates exact key sets (`hasAll` + `hasOnly`), string length limits, enum allowlists, numeric bounds, and path variable regex (`^[a-zA-Z0-9_\-]+$`).
5. **Privilege Escalation Prevention**: Non-admin users cannot create or modify `/admins/{uid}` documents or spoof admin access via unverified email tokens.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated Product Create**: Anonymous visitor writes `{ title: "Free Game", priceRub: 1 }` to `/products/hack-1`. -> MUST DENY.
2. **Non-Admin Authenticated Product Update**: Verified regular user updates `priceRub: 1` on `/products/prod-1`. -> MUST DENY.
3. **Spoofed Unverified Admin Email**: Auth token has `email: "rean4er@gmail.com"` with `email_verified: false` reading `/sales/sale-1`. -> MUST DENY.
4. **PII Leak via Sales Get**: Non-admin authenticated user attempts `get` on `/sales/CGS-100001`. -> MUST DENY.
5. **PII Leak via Sales List**: Non-admin authenticated user attempts `list` on `/sales`. -> MUST DENY.
6. **Shadow Field Injection on Product**: Admin writes valid Product plus `isVerified: true` ghost field. -> MUST DENY.
7. **Shadow Field Injection on Sale**: Admin writes valid Sale plus `commissionOverride: 99` ghost field. -> MUST DENY.
8. **ID Poisoning**: Admin attempts create on `/products/invalid$id!with/junk` or >128 chars. -> MUST DENY.
9. **Value Poisoning (Negative/Huge Price)**: Admin attempts `priceRub: -500` or `priceRub: 999999999`. -> MUST DENY.
10. **Client Timestamp Forgery**: Admin sends `createdAt: Timestamp(2020-01-01)` instead of `request.time`. -> MUST DENY.
11. **Immutable Field Tampering**: Admin attempts to alter `createdBy` or `createdAt` during an update. -> MUST DENY.
12. **Self-Assigned Admin Escalation**: Regular user writes `{ uid: selfUid, email: "user@example.com", role: "admin" }` to `/admins/{selfUid}`. -> MUST DENY.
