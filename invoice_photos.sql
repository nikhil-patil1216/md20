-- Run this ONCE in Supabase -> SQL Editor -> New query -> Run
-- Stores the original invoice photo of each vehicle (Feature: Invoice Photo save)
create table if not exists public.invoice_photos (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
create index if not exists invoice_photos_vehicle_idx on public.invoice_photos ((data->>'vehicleId'));
alter table public.invoice_photos enable row level security;
drop policy if exists "invoice_photos_auth_all" on public.invoice_photos;
create policy "invoice_photos_auth_all" on public.invoice_photos
  for all to authenticated using (true) with check (true);
