-- Edge-гейт web-push-notify (m6): deadline-джоб шлёт X-Push-Secret.
-- Секрет живёт в vault (name='web_push_secret') и читается при КАЖДОМ запуске джоба —
-- в этом файле и в cron.job.command самого секрета НЕТ. Создание секрета — шаг
-- deploy/web-push/apply-secret-gate.sh (значение секретно, в миграцию не кладём).
-- Тот же секрет — в config.json функции на edge-хосте (pushSecret).

select cron.unschedule('web-push-deadline')
  where exists (select 1 from cron.job where jobname = 'web-push-deadline');

select cron.schedule(
  'web-push-deadline',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/web-push-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'web_push_secret'), '')
    ),
    body := jsonb_build_object('type', 'deadline'),
    timeout_milliseconds := 30000
  );
  $$
);
