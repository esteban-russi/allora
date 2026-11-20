import { describe, expect, it, vi } from 'vitest';
import { createIdentityAdmin } from '../src/platform/server/identityAdmin';

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn()
}));

const mockDeleteUser = vi.fn();
const mockGetUser = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    deleteUser: mockDeleteUser,
    getUser: mockGetUser
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

  it('reports every user as existing when GCP_PROJECT is not set', async () => {
    const admin = createIdentityAdmin({});
    await expect(admin.userExists('any-user')).resolves.toBe(true);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('reports an existing firebase user as existing', async () => {
    mockGetUser.mockResolvedValueOnce({ uid: 'uid-123' });
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.userExists('uid-123')).resolves.toBe(true);
  });

  it('reports a deleted firebase user as missing', async () => {
    const error = Object.assign(new Error('User not found'), { code: 'auth/user-not-found' });
    mockGetUser.mockRejectedValueOnce(error);
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.userExists('uid-gone')).resolves.toBe(false);
  });

  it('rethrows other lookup errors from firebase-admin', async () => {
    const error = Object.assign(new Error('Permission denied'), { code: 'auth/insufficient-permission' });
    mockGetUser.mockRejectedValueOnce(error);
    const admin = createIdentityAdmin({ GCP_PROJECT: 'test-project' });
    await expect(admin.userExists('uid-fail')).rejects.toThrow('Permission denied');
  });
});
