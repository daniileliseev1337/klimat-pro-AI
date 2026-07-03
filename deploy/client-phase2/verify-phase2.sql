-- E2E Фаза 2 — переписка + client_visible файлы. Самодостаточно: создаёт temp
-- client+project+file, эмулирует заказчика B / команду A / постороннего C.
-- Оборачивается в BEGIN/ROLLBACK снаружи (verify-phase2.sh) — следов не оставляет.
-- A = сотрудник-владелец (1-й approved profile), B = заказчик (2-й approved profile).

-- claims на сотрудника A (owner записи) — чтобы set_client_user прошёл его гейт
select set_config('request.jwt.claims',
  json_build_object('sub',(select id::text from public.profiles where approved order by created_at limit 1),
                    'role','authenticated')::text, true);

insert into public.clients(owner_id,name)
  values ((select id from public.profiles where approved order by created_at limit 1),'CP2_VERIFY_CLIENT');
insert into public.projects(owner_id,name,visibility,stage,contract_sum,paid_amount,notes,client_id)
  values ((select id from public.profiles where approved order by created_at limit 1),
          'CP2_VERIFY_PROJ','private','В работе',200000,50000,'внутренняя заметка',
          (select id from public.clients where name='CP2_VERIFY_CLIENT'));
select public.set_client_user(
  (select id from public.clients where name='CP2_VERIFY_CLIENT'),
  (select id from public.profiles where approved order by created_at offset 1 limit 1));

-- ── переписка ──
do $$
declare a_id text; b_id text; proj uuid; v_cnt int; v_mine bool; msg_id uuid;
begin
  select id::text into a_id from public.profiles where approved order by created_at limit 1;
  select id::text into b_id from public.profiles where approved order by created_at offset 1 limit 1;
  select id into proj from public.projects where name='CP2_VERIFY_PROJ';

  -- заказчик B пишет и читает свой тред
  perform set_config('request.jwt.claims', json_build_object('sub',b_id,'role','authenticated')::text, true);
  select public.post_client_message(proj,'привет от заказчика') into msg_id;
  select count(*), bool_or(is_mine) into v_cnt, v_mine from public.get_client_messages(proj);
  if v_cnt < 1 then raise exception 'FAIL: заказчик не видит своё сообщение'; end if;
  if not v_mine then raise exception 'FAIL: is_mine=false для своего сообщения'; end if;

  -- команда A видит тот же тред (единый канал)
  perform set_config('request.jwt.claims', json_build_object('sub',a_id,'role','authenticated')::text, true);
  select count(*) into v_cnt from public.get_client_messages(proj);
  if v_cnt < 1 then raise exception 'FAIL: команда не видит client_messages'; end if;

  -- посторонний C — тред пуст
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text, true);
  select count(*) into v_cnt from public.get_client_messages(proj);
  if v_cnt <> 0 then raise exception 'FAIL: посторонний видит % сообщений', v_cnt; end if;

  raise notice 'MESSAGES_OK';
end $$;

-- ── файлы client_visible ──
do $$
declare a_id text; b_id text; fid uuid; proj uuid; v_files int; ok bool;
begin
  select id::text into a_id from public.profiles where approved order by created_at limit 1;
  select id::text into b_id from public.profiles where approved order by created_at offset 1 limit 1;
  select id into proj from public.projects where name='CP2_VERIFY_PROJ';

  insert into public.project_files(project_id,owner_id,filename,disk_path,file_size,mime_type)
    values (proj, a_id::uuid, 'doc.pdf', 'projects/'||proj||'/verify-doc.pdf', 123, 'application/pdf')
    returning id into fid;

  -- заказчик B пока НЕ видит (client_visible=false по умолчанию)
  perform set_config('request.jwt.claims', json_build_object('sub',b_id,'role','authenticated')::text, true);
  select count(*) into v_files from public.get_client_project_files(proj);
  if v_files <> 0 then raise exception 'FAIL: заказчик видит не-client_visible файл'; end if;

  -- команда A помечает «показать заказчику»
  perform set_config('request.jwt.claims', json_build_object('sub',a_id,'role','authenticated')::text, true);
  perform public.set_file_client_visible(fid, true);

  -- теперь заказчик B видит ровно 1
  perform set_config('request.jwt.claims', json_build_object('sub',b_id,'role','authenticated')::text, true);
  select count(*) into v_files from public.get_client_project_files(proj);
  if v_files <> 1 then raise exception 'FAIL: заказчик не видит client_visible файл (cnt=%)', v_files; end if;

  -- гейт: заказчик сам НЕ может пометить файл
  ok := false;
  begin
    perform public.set_file_client_visible(fid, false);
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: заказчик смог set_file_client_visible'; end if;

  raise notice 'FILES_OK';
end $$;
