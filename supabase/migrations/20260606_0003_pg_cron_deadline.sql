-- Расширения для deadline-cron. pg_cron уже в shared_preload_libraries PG17,
-- pg_net установлен. cron.job для web-push-deadline добавляется ниже (Task 15).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (Task 15) cron job web-push-deadline. Ежедневно 09:00 → POST в edge на kong:8000
-- (грабля self-hosted supabase#44907: только внутренний kong, НЕ cloud/localhost).
-- Edge-функция web-push-notify не требует JWT (FUNCTIONS_VERIFY_JWT off) и вызывается
-- по внутренней docker-сети — Authorization не нужен.
select cron.unschedule('web-push-deadline')
  where exists (select 1 from cron.job where jobname = 'web-push-deadline');

select cron.schedule(
  'web-push-deadline',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/web-push-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('type', 'deadline'),
    timeout_milliseconds := 30000
  );
  $$
);
