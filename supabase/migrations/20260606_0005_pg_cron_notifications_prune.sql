-- Retention Центра уведомлений: чистим ТОЛЬКО прочитанные старше 7 дней.
-- Непрочитанные сохраняются бессрочно (страховка от эфемерности push).
-- pg_cron/pg_net уже включены миграцией 20260606_0003_pg_cron_deadline.sql.
select cron.unschedule('notifications-prune')
  where exists (select 1 from cron.job where jobname = 'notifications-prune');

select cron.schedule(
  'notifications-prune',
  '30 3 * * *',  -- ежедневно 03:30
  $$ delete from public.notifications
     where read = true and created_at < now() - interval '7 days' $$
);
