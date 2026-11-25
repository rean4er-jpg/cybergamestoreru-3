/**
 * Security Rules Test Suite Specification (Phase 0 TDD)
 * Verifies all 12 "Dirty Dozen" adversarial payloads against firestore.rules.
 */

export interface AdversarialCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Product Create',
    operation: 'create',
    path: '/products/hack-1',
    auth: null,
    payload: { id: 'hack-1', title: 'Free Game', priceRub: 1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Non-Admin Authenticated Product Update',
    operation: 'update',
    path: '/products/prod-1',
    auth: { uid: 'user-123', email: 'buyer@example.com', email_verified: true },
    payload: { priceRub: 1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Spoofed Unverified Admin Email',
    operation: 'get',
    path: '/sales/CGS-100001',
    auth: { uid: 'spoof-1', email: 'rean4er@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'PII Leak via Sales Get',
    operation: 'get',
    path: '/sales/CGS-100001',
    auth: { uid: 'user-123', email: 'buyer@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'PII Leak via Sales List',
    operation: 'list',
    path: '/sales',
    auth: { uid: 'user-123', email: 'buyer@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow Field Injection on Product',
    operation: 'create',
    path: '/products/prod-shadow',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { id: 'prod-shadow', title: 'Ghost Game', isVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Shadow Field Injection on Sale',
    operation: 'create',
    path: '/sales/sale-shadow',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { id: 'sale-shadow', commissionOverride: 99 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning on Product Path',
    operation: 'create',
    path: '/products/invalid$id!poison',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { id: 'invalid$id!poison', title: 'Poison' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Value Poisoning Negative Price',
    operation: 'create',
    path: '/products/prod-neg',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { id: 'prod-neg', priceRub: -500 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/sales/sale-time',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { id: 'sale-time', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Immutable Field Tampering',
    operation: 'update',
    path: '/products/prod-1',
    auth: { uid: 'admin-1', email: 'rean4er@gmail.com', email_verified: true },
    payload: { createdBy: 'another-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Self-Assigned Admin Escalation',
    operation: 'create',
    path: '/admins/user-123',
    auth: { uid: 'user-123', email: 'buyer@example.com', email_verified: true },
    payload: { uid: 'user-123', email: 'buyer@example.com', role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
];
