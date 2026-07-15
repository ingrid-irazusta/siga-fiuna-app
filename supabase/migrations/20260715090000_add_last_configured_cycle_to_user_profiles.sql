begin;

alter table public.user_profiles
add column if not exists last_configured_cycle text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_last_configured_cycle_format'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
    add constraint user_profiles_last_configured_cycle_format
    check (
      last_configured_cycle is null
      or last_configured_cycle ~ '^[0-9]{4}-[12]$'
    );
  end if;
end;
$$;

comment on column public.user_profiles.last_configured_cycle
is 'Último ciclo académico configurado correctamente, en formato YYYY-1 o YYYY-2.';

commit;
