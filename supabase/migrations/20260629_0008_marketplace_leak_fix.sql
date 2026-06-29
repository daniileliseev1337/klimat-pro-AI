-- 20260629_0008: §7 — marketplace-ветки видят только СОТРУДНИКИ (is_employee), не любой approved.
-- Закрывает утечку: чистый заказчик больше не видит чужие marketplace-проекты прямым запросом.
-- Свой проект заказчик видит через get_my_client_projects (Task 9), НЕ через projects_select.
-- Применять ПОСЛЕ 0009.

-- 1. projects_select
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_admin()
    or (visibility = 'team' and public.is_project_member(id))
    or (visibility = 'marketplace' and public.is_employee())   -- было is_approved()
  );

-- 2. can_access_project_comments — marketplace-ветка на is_employee (ветка is_project_client из 0002 сохранена)
create or replace function public.can_access_project_comments(p_project_id uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id
      and (
        owner_id = auth.uid()
        or public.is_admin()
        or (visibility = 'team' and public.is_project_member(p_project_id))
        or (visibility = 'marketplace' and public.is_employee())  -- было is_approved()
        or public.is_project_client(p_project_id)
      )
  );
$$;
