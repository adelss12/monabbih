-- منبّه: جدول الاشتراكات والوثائق
-- الصقه كاملًا في Supabase ← SQL Editor ← New query ثم اضغط Run

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  type        text not null default 'sub' check (type in ('sub','passport','license','id','vehicle','other')),
  cycle       text not null default 'none' check (cycle in ('monthly','yearly','none')),
  lead_days   int  not null default 7 check (lead_days between 0 and 365),
  cal         text not null default 'g' check (cal in ('g','h')),
  expires_on  date not null,
  created_at  timestamptz not null default now()
);

create index if not exists items_user_idx on public.items (user_id);

-- صلاحيات الوصول عبر واجهة البيانات (للمستخدمين المسجّلين فقط، لا للزوار)
revoke all on public.items from anon;
grant select, insert, update, delete on public.items to authenticated;
grant all on public.items to service_role;

-- كل مستخدم يرى ويعدّل بياناته فقط
alter table public.items enable row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items for select using (auth.uid() = user_id);
create policy "items_insert_own" on public.items for insert with check (auth.uid() = user_id);
create policy "items_update_own" on public.items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items_delete_own" on public.items for delete using (auth.uid() = user_id);
