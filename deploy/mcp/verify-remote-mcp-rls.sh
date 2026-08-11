#!/usr/bin/env bash
set -euo pipefail
docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

select id::text as admin_id from public.profiles where role = 'admin' limit 1 \gset
select id::text as user1_id from public.profiles where approved and role <> 'admin' order by id limit 1 \gset
select id::text as user2_id from public.profiles where approved and role <> 'admin' order by id offset 1 limit 1 \gset

delete from public.mcp_user_access where user_id in (:'user1_id'::uuid, :'user2_id'::uuid);

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', :'user1_id', 'role', 'authenticated')::text, true);
select 1 / ((select count(*) from public.mcp_user_access) = 0)::int as default_deny_ok;

\set ON_ERROR_STOP off
savepoint non_admin_mutation;
select public.admin_set_mcp_access(:'user1_id'::uuid, 'write');
\if :ERROR
  rollback to savepoint non_admin_mutation;
  \echo NON_ADMIN_MUTATION_DENIED
\else
  \quit 1
\endif
\set ON_ERROR_STOP on

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
select public.admin_set_mcp_access(:'user1_id'::uuid, 'read');
select public.admin_set_mcp_access(:'user2_id'::uuid, 'write');
select 1 / ((select count(*) from public.mcp_user_access where user_id in (:'user1_id'::uuid, :'user2_id'::uuid)) = 2)::int as admin_reads_all_ok;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', :'user1_id', 'role', 'authenticated')::text, true);
select 1 / ((select count(*) from public.mcp_user_access where user_id = :'user1_id'::uuid and access_level = 'read') = 1)::int as owner_reads_own_ok;
select 1 / ((select count(*) from public.mcp_user_access where user_id = :'user2_id'::uuid) = 0)::int as other_user_hidden_ok;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
select public.admin_set_mcp_access(:'user1_id'::uuid, 'none');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', :'user1_id', 'role', 'authenticated')::text, true);
select 1 / ((select count(*) from public.mcp_user_access) = 0)::int as revoke_visible_ok;

reset role;
rollback;
SQL
echo REMOTE_MCP_RLS_E2E_OK
