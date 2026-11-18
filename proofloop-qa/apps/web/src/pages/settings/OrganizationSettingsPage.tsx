import { useEffect, useState } from 'react';
import { Users, Shield, ShieldAlert, AlertCircle, Loader2, UserX, Search, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { getOrganizationUsers, updateUserRole, softDeleteUser, type OrgUser, type UserRole } from '@/lib/api/organization';
import { getApiErrorMessage } from '@/lib/api-error';

const ROLES: UserRole[] = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER', 'VIEWER'];

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  QA_LEAD: 'QA Lead',
  QA_ENGINEER: 'QA Engineer',
  VIEWER: 'Viewer (Read-only)',
};

const ROLE_BADGES: Record<UserRole, string> = {
  ADMIN: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  QA_LEAD: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  QA_ENGINEER: 'bg-green-500/10 text-green-500 border-green-500/20',
  VIEWER: 'bg-sidebar-accent text-sidebar-foreground border-border',
};

export default function OrganizationSettingsPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation modal state for soft deletion
  const [userToDeactivate, setUserToDeactivate] = useState<OrgUser | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setError(null);
      const data = await getOrganizationUsers();
      setUsers(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load organization users'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      fetchUsers();
    } else {
      setIsLoading(false);
    }
  }, [currentUser]);

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-center">
        <div className="rounded-full bg-red-500/10 p-4 text-red-500 mb-4">
          <ShieldAlert className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Administrator Access Required</h2>
        <p className="mt-2 max-w-md text-sm text-sidebar-foreground">
          Team roster and user management is restricted to Administrators. Please contact an organization Admin if you need access.
        </p>
      </div>
    );
  }

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      setError(null);
      setSuccessMessage(null);
      setUpdatingRoleId(userId);

      const updated = await updateUserRole(userId, newRole);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setSuccessMessage(`Role for ${updated.firstName} ${updated.lastName} updated to ${ROLE_LABELS[newRole]}`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update user role'));
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!userToDeactivate) return;
    try {
      setIsDeactivating(true);
      setError(null);
      setSuccessMessage(null);

      await softDeleteUser(userToDeactivate.id);
      setUsers((prev) => prev.filter((u) => u.id !== userToDeactivate.id));
      setSuccessMessage(`User ${userToDeactivate.firstName} ${userToDeactivate.lastName} deactivated successfully`);
      setUserToDeactivate(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to deactivate user'));
    } finally {
      setIsDeactivating(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  const adminCount = users.filter((u) => u.role === 'ADMIN').length;
  const leadCount = users.filter((u) => u.role === 'QA_LEAD').length;
  const engineerCount = users.filter((u) => u.role === 'QA_ENGINEER').length;
  const viewerCount = users.filter((u) => u.role === 'VIEWER').length;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading team members">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Team Roster</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">
            Manage organization members, assign roles, and handle account deactivations.
          </p>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-sidebar p-4 shadow-sm">
          <div className="flex items-center space-x-2 text-xs font-medium text-sidebar-foreground">
            <Users className="h-4 w-4" />
            <span>Total Members</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{users.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-sidebar p-4 shadow-sm">
          <div className="flex items-center space-x-2 text-xs font-medium text-purple-400">
            <Shield className="h-4 w-4" />
            <span>Administrators</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{adminCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-sidebar p-4 shadow-sm">
          <div className="flex items-center space-x-2 text-xs font-medium text-blue-400">
            <Users className="h-4 w-4" />
            <span>QA Leads</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{leadCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-sidebar p-4 shadow-sm">
          <div className="flex items-center space-x-2 text-xs font-medium text-green-400">
            <Users className="h-4 w-4" />
            <span>Engineers & Viewers</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{engineerCount + viewerCount}</div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center space-x-2 rounded-md border border-green-500/20 bg-green-500/10 p-4 text-green-500">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{successMessage}</span>
        </div>
      )}

      {/* Search and Table */}
      <div className="space-y-4">
        <div className="flex items-center">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search team members"
              className="w-full rounded-md border border-border bg-sidebar pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="relative overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-sidebar-accent/50 text-xs uppercase tracking-wider text-sidebar-foreground">
              <tr>
                <th scope="col" className="px-6 py-3 font-semibold">User</th>
                <th scope="col" className="px-6 py-3 font-semibold">Email</th>
                <th scope="col" className="px-6 py-3 font-semibold">Joined Date</th>
                <th scope="col" className="px-6 py-3 font-semibold">Role</th>
                <th scope="col" className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sidebar-foreground">
                    No team members found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUser?.id;
                  const isUpdating = updatingRoleId === u.id;

                  return (
                    <tr key={u.id} className="hover:bg-sidebar-accent/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                            {u.firstName[0]?.toUpperCase()}{u.lastName[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-foreground">
                              {u.firstName} {u.lastName} {isCurrent && <span className="ml-1 text-xs text-primary font-normal">(You)</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-sidebar-foreground">{u.email}</td>
                      <td className="px-6 py-4 text-xs text-sidebar-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <select
                            value={u.role}
                            disabled={isUpdating}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                            aria-label={`Change role for ${u.firstName} ${u.lastName}`}
                            className={`rounded-md border border-border bg-sidebar px-2.5 py-1 text-xs font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${ROLE_BADGES[u.role]}`}
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role} className="bg-sidebar text-foreground">
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                          {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          disabled={isCurrent}
                          onClick={() => setUserToDeactivate(u)}
                          title={isCurrent ? 'You cannot deactivate your own account' : 'Deactivate user'}
                          className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            isCurrent
                              ? 'cursor-not-allowed opacity-40 text-sidebar-foreground'
                              : 'text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20'
                          }`}
                        >
                          <UserX className="mr-1.5 h-3.5 w-3.5" />
                          Deactivate
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      {userToDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-labelledby="deactivate-dialog-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border bg-sidebar p-6 shadow-xl"
          >
            <div className="flex items-center space-x-3 text-red-500">
              <div className="rounded-full bg-red-500/10 p-2">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 id="deactivate-dialog-title" className="text-lg font-bold text-foreground">
                Deactivate Team Member
              </h3>
            </div>
            <p className="mt-3 text-sm text-sidebar-foreground">
              Are you sure you want to deactivate <strong className="text-foreground">{userToDeactivate.firstName} {userToDeactivate.lastName}</strong> (<span className="font-mono text-xs">{userToDeactivate.email}</span>)?
            </p>
            <p className="mt-2 text-xs text-sidebar-foreground">
              This account will be softly deleted: the user will be immediately logged out and prevented from signing in. All audit history, reported defects, and past execution logs will be securely preserved.
            </p>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setUserToDeactivate(null)}
                disabled={isDeactivating}
                className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground hover:bg-sidebar-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={isDeactivating}
                className="flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                {isDeactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Deactivation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
