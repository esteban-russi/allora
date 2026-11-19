import { describe, expect, it, vi } from 'vitest';
import { createIdentityAdmin } from '../src/server/identityAdmin';

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn()
}));

const mockDeleteUser = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    deleteUser: mockDeleteUser
  }))
}));

describe('identityAdmin', () => {
  it('returns a no-op identity admin when GCP_PROJECT is not set', async () => {
    const admin = createIdentityAdmin({});
    await expect(admin.deleteUser('any-user')).resolves.toBeUndefined();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('deletes user through firebase-admin when GCP_PROJECT is configured', async () => {
    mockDeleteUser.mockResolvedValueOnce(undefined);
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.deleteUser('uid-123')).resolves.toBeUndefined();
    expect(mockDeleteUser).toHaveBeenCalledWith('uid-123');
  });

  it('ignores auth/user-not-found errors from firebase-admin', async () => {
    const error = Object.assign(new Error('User not found'), { code: 'auth/user-not-found' });
    mockDeleteUser.mockRejectedValueOnce(error);
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.deleteUser('uid-missing')).resolves.toBeUndefined();
  });

  it('rethrows other errors from firebase-admin', async () => {
    const error = Object.assign(new Error('Permission denied'), { code: 'auth/insufficient-permission' });
    mockDeleteUser.mockRejectedValueOnce(error);
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.deleteUser('uid-fail')).rejects.toThrow('Permission denied');
  });
});
