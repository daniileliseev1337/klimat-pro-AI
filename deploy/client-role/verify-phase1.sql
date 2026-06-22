-- E2E фаза 1. A=сотрудник-владелец записи, B=заказчик-аккаунт, C=посторонний.
select set_config('request.jwt.claims',
  json_build_object('sub',(select id::text from public.profiles where approved order by created_at limit 1),
                    'role','authenticated')::text, true);
insert into public.clients(owner_id,name)
  values ((select id from public.profiles where approved order by created_at limit 1),'CR_VERIFY_CLIENT');
insert into public.projects(owner_id,name,visibility,stage,contract_sum,paid_amount,notes,client_id)
  values ((select id from public.profiles where approved order by created_at limit 1),
          'CR_VERIFY_PROJ','private','В работе',200000,50000,'внутренняя заметка',
          (select id from public.clients where name='CR_VERIFY_CLIENT'));
select public.set_client_user(
  (select id from public.clients where name='CR_VERIFY_CLIENT'),
  (select id from public.profiles where approved order by created_at offset 1 limit 1));

do $$
declare a_id text; b_id text; v_amA bool; v_amB bool; v_cnt int; v_paid numeric; v_cprojs int;
begin
  select id::text into a_id from public.profiles where approved order by created_at limit 1;
  select id::text into b_id from public.profiles where approved order by created_at offset 1 limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub',b_id,'role','authenticated')::text, true);
  select public.am_i_client() into v_amB;
  select count(*), max(paid_amount) into v_cnt, v_paid from public.get_my_client_projects();

  perform set_config('request.jwt.claims', json_build_object('sub',a_id,'role','authenticated')::text, true);
  select public.am_i_client() into v_amA;

  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text, true);
  select count(*) into v_cprojs from public.get_my_client_projects();

  if not v_amB then raise exception 'FAIL: заказчик B am_i_client=false'; end if;
  if v_cnt < 1 then raise exception 'FAIL: B не видит свой заказ (cnt=%)', v_cnt; end if;
  if v_paid <> 50000 then raise exception 'FAIL: проекция paid_amount=% (ожид 50000)', v_paid; end if;
  if v_amA then raise exception 'FAIL: сотрудник A ошибочно am_i_client=true'; end if;
  if v_cprojs <> 0 then raise exception 'FAIL: посторонний видит % заказов', v_cprojs; end if;
  raise notice 'CLIENT_ROLE_OK amB=% cnt=% paid=% amA=% c=%', v_amB,v_cnt,v_paid,v_amA,v_cprojs;
end $$;

do $$
declare ok bool := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text, true);
  begin
    perform public.set_client_user((select id from public.clients where name='CR_VERIFY_CLIENT'), null);
  exception when others then ok := true;  -- ожидаем not_client_owner
  end;
  if not ok then raise exception 'FAIL: посторонний смог set_client_user'; end if;
  raise notice 'SET_CLIENT_USER_GATE_OK';
end $$;
