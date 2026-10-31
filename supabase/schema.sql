-- Massless owns only these namespaced tables and the massless-private bucket.
create table public.massless_projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 120),
 created_at timestamptz not null default now(),
 unique(id,owner_id)
);
create table public.massless_assets (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 project_id uuid not null,
 name text not null check (char_length(name) between 1 and 200),
 object_path text not null unique check (object_path like owner_id::text || '/%'),
 kind text not null check (kind in ('image','audio','video','document','workflow')),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.massless_projects(id,owner_id) on delete cascade
);
create table public.massless_workflow_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 workflow_id text not null check(char_length(workflow_id) between 1 and 100),
 project_id uuid,
 state jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.massless_projects(id,owner_id)
);
create index massless_projects_owner on public.massless_projects(owner_id,created_at desc);
create index massless_assets_project on public.massless_assets(owner_id,project_id,created_at desc);
create index massless_runs_owner on public.massless_workflow_runs(owner_id,updated_at desc);
alter table public.massless_projects enable row level security;
alter table public.massless_assets enable row level security;
alter table public.massless_workflow_runs enable row level security;
grant select,insert,update,delete on public.massless_projects,public.massless_assets,public.massless_workflow_runs to authenticated;
revoke all on public.massless_projects,public.massless_assets,public.massless_workflow_runs from anon;
create policy massless_projects_owner on public.massless_projects to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy massless_assets_owner on public.massless_assets to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy massless_runs_owner on public.massless_workflow_runs to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('massless-private','massless-private',false,31457280,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','audio/x-wav','audio/mp4','video/mp4','application/pdf','application/json']);
create policy massless_private_files on storage.objects for all to authenticated using (bucket_id='massless-private' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='massless-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
