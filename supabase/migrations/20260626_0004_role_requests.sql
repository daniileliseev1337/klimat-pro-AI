-- 20260626_0004: Ф3 — единый список заявок/намерений роли для админки.
-- Расширяет admin_list_access_requests: показывает не только visitor-заявки (access_requested),
-- но и роль, выбранную при самрегистрации employee/client (requested_role у ещё не одобренных).
-- is_access_request=true → посетитель просит доступ из демо; false → самрега ждёт одобрения.

drop function if exists public.admin_list_access_requests();

create or replace function public.admin_list_role_requests()
returns table (user_id uuid, requested_role text, is_access_request boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select id, requested_role, access_requested
    from public.profiles
   where requested_role is not null
     and (access_requested = true or coalesce(approved, false) = false)
     and public.is_admin();
$$;
grant execute on function public.admin_list_role_requests() to authenticated;
