-- Tighten expire-opens cron: every minute + 15s HTTP timeout.
-- Preserves the existing Authorization header already configured on the job.
-- If the job is missing, create it via Dashboard → Integrations → Cron
-- (Edge Function: expire-opens, schedule: * * * * *).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_jobid bigint;
  v_old text;
  v_auth text;
begin
  select jobid, command into v_jobid, v_old
  from cron.job
  where jobname = 'expire-opens'
  limit 1;

  if v_jobid is null then
    raise notice 'expire-opens cron job missing — schedule it in Dashboard → Integrations → Cron';
    return;
  end if;

  v_auth := substring(v_old from 'Bearer ([^"''[:space:]]+)');

  if v_auth is null or length(v_auth) < 10 then
    perform cron.alter_job(v_jobid, schedule := '* * * * *');
    return;
  end if;

  perform cron.alter_job(
    v_jobid,
    schedule := '* * * * *',
    command := format(
      $cmd$
select net.http_post(
  url := 'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/expire-opens',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer %s'
  ),
  body := jsonb_build_object('source', 'pg_cron', 'time', now()),
  timeout_milliseconds := 15000
);
$cmd$,
      v_auth
    )
  );
end $$;
