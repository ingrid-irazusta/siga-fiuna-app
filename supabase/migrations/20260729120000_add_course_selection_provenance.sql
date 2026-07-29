begin;

alter table public.student_courses
  add column if not exists selected_section text null;

alter table public.student_classes
  add column if not exists source text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_classes_source_check'
      and conrelid = 'public.student_classes'::regclass
  ) then
    alter table public.student_classes
      add constraint student_classes_source_check
      check (
        source is null
        or source in ('distribution', 'manual')
      )
      not valid;
  end if;
end;
$$;

comment on column public.student_courses.selected_section is
  'Sección elegida para resolver datos vigentes de la distribución. Nullable para compatibilidad con cursos existentes.';

comment on column public.student_classes.source is
  'Procedencia de la clase: distribution o manual. NULL identifica registros históricos sin procedencia confirmada.';

commit;
