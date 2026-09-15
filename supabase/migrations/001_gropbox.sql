-- GropBox: run once in a new Supabase project. This migration never edits Drive files.
create extension if not exists pg_trgm with schema extensions;

create table public.app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_sub text not null unique,
  active boolean not null default true,
  workspace jsonb,
  created_at timestamptz not null default now()
);
create table public.google_credentials (
  user_id uuid primary key references public.app_accounts(user_id) on delete cascade,
  refresh_cipher text not null,
  access_cipher text,
  expires_at bigint not null default 0
);
create table public.messages (
  id uuid primary key,
  user_id uuid not null references public.app_accounts(user_id) on delete cascade,
  kind text not null check (kind in ('message','document')),
  format text not null check (format in ('rich','text','markdown')),
  title text not null check (length(title) <= 200),
  -- API limits UTF-8 input to 200 KB; JSONB text adds whitespace during normalization.
  body jsonb not null check (octet_length(body::text) <= 400000),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 30),
  search_text text not null,
  pinned boolean not null default false,
  deleted boolean not null default false,
  version integer not null default 1 check (version > 0),
  archive_version integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index messages_timeline on public.messages(user_id, created_at desc, id desc) where not deleted;
create index messages_search on public.messages using gin (search_text extensions.gin_trgm_ops) where not deleted;
create table public.attachments (
  user_id uuid not null references public.app_accounts(user_id) on delete cascade,
  file_id text not null,
  upload_id uuid not null,
  metadata jsonb not null,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id),
  unique (user_id, upload_id)
);
create table public.drive_folders (
  user_id uuid not null references public.app_accounts(user_id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  file_id text not null,
  primary key (user_id, month)
);
create table public.archive_jobs (
  user_id uuid not null references public.app_accounts(user_id) on delete cascade,
  operation_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  version integer not null,
  request_hash text not null,
  snapshot jsonb not null,
  drive_file_id text,
  done boolean not null default false,
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id),
  unique (message_id, version)
);
create index archive_pending on public.archive_jobs(next_attempt_at) where not done;

alter table public.app_accounts enable row level security;
alter table public.google_credentials enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.drive_folders enable row level security;
alter table public.archive_jobs enable row level security;
revoke all on public.app_accounts, public.google_credentials, public.messages, public.attachments, public.drive_folders, public.archive_jobs from anon, authenticated;
grant select on public.app_accounts, public.messages, public.attachments to authenticated;
grant all on public.app_accounts, public.google_credentials, public.messages, public.attachments, public.drive_folders, public.archive_jobs to service_role;
create policy account_self on public.app_accounts for select to authenticated using (user_id = (select auth.uid()) and active);
create policy message_self on public.messages for select to authenticated using (user_id = (select auth.uid()) and exists (select 1 from public.app_accounts a where a.user_id = messages.user_id and a.active));
create policy attachment_self on public.attachments for select to authenticated using (user_id = (select auth.uid()) and exists (select 1 from public.app_accounts a where a.user_id = attachments.user_id and a.active));

-- Mutations enter through the authenticated Next.js endpoint, not direct client table writes.
-- The account lock makes new-message creation and idempotency atomic, even before a row exists.
create function public.save_message(p_user_id uuid, p_mutation jsonb, p_search_text text, p_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare current_row public.messages; saved public.messages; receipt public.archive_jobs;
begin
  perform 1 from public.app_accounts where user_id = p_user_id and active for update;
  if not found then raise exception 'ACCOUNT_DISABLED' using errcode = '42501'; end if;
  select * into receipt from public.archive_jobs where user_id = p_user_id and operation_id = (p_mutation->>'operationId')::uuid;
  if found then
    if receipt.request_hash <> p_hash then raise exception 'OPERATION_REUSED' using errcode = '22023'; end if;
    return receipt.snapshot;
  end if;
  select * into current_row from public.messages where id = (p_mutation->>'id')::uuid;
  if found then
    if current_row.user_id <> p_user_id or current_row.version <> (p_mutation->>'expectedVersion')::int then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
  elsif (p_mutation->>'expectedVersion')::int <> 0 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_mutation->'attachments') item where not exists (
    select 1 from public.attachments a where a.user_id = p_user_id and a.file_id = item->>'id' and a.ready and a.metadata = item
  )) then raise exception 'ATTACHMENT_NOT_READY' using errcode = '22023'; end if;
  insert into public.messages(id,user_id,kind,format,title,body,attachments,search_text,pinned,deleted)
  values ((p_mutation->>'id')::uuid,p_user_id,p_mutation->>'kind',p_mutation->>'format',p_mutation->>'title',p_mutation->'body',p_mutation->'attachments',p_search_text,(p_mutation->>'pinned')::boolean,(p_mutation->>'deleted')::boolean)
  on conflict (id) do update set
    kind = excluded.kind, format = excluded.format, title = excluded.title, body = excluded.body,
    attachments = excluded.attachments, search_text = excluded.search_text, pinned = excluded.pinned,
    deleted = excluded.deleted, version = public.messages.version + 1, updated_at = clock_timestamp()
  where public.messages.user_id = p_user_id and public.messages.version = (p_mutation->>'expectedVersion')::int
  returning * into saved;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  insert into public.archive_jobs(user_id,operation_id,message_id,version,request_hash,snapshot)
  values (p_user_id,(p_mutation->>'operationId')::uuid,saved.id,saved.version,p_hash,to_jsonb(saved));
  return to_jsonb(saved);
end $$;
revoke all on function public.save_message(uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.save_message(uuid,jsonb,text,text) to service_role;

create function public.reserve_workspace(p_user_id uuid, p_workspace jsonb)
returns jsonb language sql set search_path = '' as $$
  update public.app_accounts set workspace = coalesce(workspace,p_workspace) where user_id = p_user_id and active returning workspace;
$$;
revoke all on function public.reserve_workspace(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_workspace(uuid,jsonb) to service_role;

create function public.claim_archives(p_user_id uuid, p_lease uuid)
returns setof public.archive_jobs language sql set search_path = '' as $$
  update public.archive_jobs set lease_id = p_lease, lease_until = now() + interval '5 minutes', attempts = attempts + 1
  where (user_id,operation_id) in (
    select j.user_id,j.operation_id from public.archive_jobs j join public.app_accounts a on a.user_id = j.user_id
    where not j.done and a.active and (p_user_id is null or j.user_id = p_user_id)
      and j.next_attempt_at <= now() and (j.lease_until is null or j.lease_until < now())
    order by j.created_at limit 5 for update of j skip locked
  ) returning *;
$$;
revoke all on function public.claim_archives(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_archives(uuid,uuid) to service_role;

create function public.finish_archive(p_user_id uuid, p_operation_id uuid, p_lease uuid)
returns void language plpgsql set search_path = '' as $$
declare job public.archive_jobs;
begin
  update public.archive_jobs set done = true, lease_id = null, lease_until = null
    where user_id = p_user_id and operation_id = p_operation_id and lease_id = p_lease returning * into job;
  if found then
    update public.messages set archive_version = greatest(archive_version,job.version)
      where user_id = p_user_id and id = job.message_id;
  end if;
end $$;
revoke all on function public.finish_archive(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_archive(uuid,uuid,uuid) to service_role;

-- Only publish the message table. Google credentials and archive snapshots stay private.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then alter publication supabase_realtime add table public.messages; end if;
end $$;
