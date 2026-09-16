# Workspace administration

Admin access comes from the `is_admin` column on the portal database's `users` table. Grant it by running SQL against the portal database as `portal_service`:

```sql
update users set is_admin = true where id = '<user id>';
```

Use the `id` returned by `/api/me`, not your email or username. Revoke access by setting the column back to `false`. The API caches the flag for up to a minute, so a grant or revoke takes effect within a minute; sign in again to refresh the sidebar.

Open **Admin** in the portal sidebar, or visit `/admin`. Search by workspace name, ID, owner email, username, or owner ID. The list includes every user's workspaces, including disabled and failed workspaces.

Open the workspace's **Actions** menu (three dots), choose **Delete workspace**, check the owner's email and workspace ID, and enter the exact workspace name. Deletion cancels the subscription, removes the workspace's machines and database, deletes published listings, and removes the workspace record. The owner's account remains. Deletion is permanent.

The API independently checks `is_admin` on every admin request. A workspace operation already in progress returns a conflict; retry after it finishes. If cleanup fails, the dialog reports the error and the workspace record stays available for retry. Earlier completed steps, such as subscription cancellation, are not rolled back. Admin IDs and deletion outcomes are recorded in control-plane logs.

The normal workspace API still requires ownership. No API, browser setting, or editable profile field grants admin access: the app's database role cannot write `is_admin`.
