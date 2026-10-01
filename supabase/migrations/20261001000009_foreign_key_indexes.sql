-- Index every foreign key that lacked a supporting index.
--
-- Without one, a referenced-row change scans the whole referencing table, and joins
-- from the referenced side can't use an index. Found by the guard test added in
-- supabase/tests/001_structure_guards.sql, which now fails the build for any new
-- foreign key without an index that starts with its first column.

-- Batches of one medicine across branches (the catalogue-wide view).
create index medicine_batches_medicine_idx on public.medicine_batches (medicine_id);

-- Permission catalogue lookups and cascades.
create index role_permissions_permission_idx on public.role_permissions (permission);
create index user_permission_overrides_permission_idx on public.user_permission_overrides (permission);

-- The existing branch_members index covers active members only (a partial index), so
-- it cannot back the foreign key to branches. Keep it for active-member lookups and
-- add a full one.
create index branch_members_branch_all_idx on public.branch_members (branch_id);
