begin;

create table if not exists public.student_note_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  materia text not null,
  attempt_number integer not null,
  nota smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_note_attempts_materia_not_empty
    check (btrim(materia) <> ''),
  constraint student_note_attempts_number_check
    check (attempt_number > 0),
  constraint student_note_attempts_grade_check
    check (nota between 1 and 5),
  constraint student_note_attempts_user_materia_number_key
    unique (user_id, materia, attempt_number)
);

alter table public.student_note_attempts enable row level security;

drop policy if exists student_note_attempts_select_own
  on public.student_note_attempts;
create policy student_note_attempts_select_own
  on public.student_note_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists student_note_attempts_insert_own
  on public.student_note_attempts;
create policy student_note_attempts_insert_own
  on public.student_note_attempts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists student_note_attempts_update_own
  on public.student_note_attempts;
create policy student_note_attempts_update_own
  on public.student_note_attempts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists student_note_attempts_delete_own
  on public.student_note_attempts;
create policy student_note_attempts_delete_own
  on public.student_note_attempts
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.student_note_attempts from anon;
grant select, insert, update, delete
  on table public.student_note_attempts
  to authenticated;

-- Backfill aditivo: conserva student_notes y copia solamente notas existentes.
insert into public.student_note_attempts (
  user_id,
  materia,
  attempt_number,
  nota
)
select
  sn.user_id,
  sn.materia,
  legacy.attempt_number,
  legacy.nota::smallint
from public.student_notes as sn
cross join lateral (
  values
    (1, sn.nota1),
    (2, sn.nota2),
    (3, sn.nota3),
    (4, sn.nota4),
    (5, sn.nota5),
    (6, sn.nota6)
) as legacy(attempt_number, nota)
where legacy.nota is not null
on conflict (user_id, materia, attempt_number)
do nothing;

create or replace function public.save_student_note_attempts(
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_attempts jsonb;
  v_materia text;
  v_optativa_nombre text;
  v_first_pass integer;
  v_affected integer := 0;
  v_deleted integer := 0;
  v_row_count integer := 0;
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Debes iniciar sesión para guardar las notas.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'La lista de notas no es válida.';
  end if;

  if jsonb_array_length(p_rows) > 500 then
    raise exception using
      errcode = '22023',
      message = 'La cantidad de materias excede el límite permitido.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as row_item(value)
    where jsonb_typeof(row_item.value) <> 'object'
       or coalesce(btrim(row_item.value->>'materia'), '') = ''
       or jsonb_typeof(row_item.value->'attempts') <> 'array'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Una o más materias tienen datos inválidos.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_rows)
  ) <> (
    select count(distinct lower(btrim(row_item.value->>'materia')))
    from jsonb_array_elements(p_rows) as row_item(value)
  ) then
    raise exception using
      errcode = '22023',
      message = 'La lista contiene materias duplicadas.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1));

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_materia := btrim(v_row->>'materia');
    v_optativa_nombre := nullif(btrim(v_row->>'optativa_nombre'), '');
    v_attempts := v_row->'attempts';

    if jsonb_array_length(v_attempts) > 100 then
      raise exception using
        errcode = '22023',
        message = format('La materia %s excede el límite de oportunidades permitido por solicitud.', v_materia);
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_attempts) as attempt_item(value)
      where jsonb_typeof(attempt_item.value) <> 'object'
         or coalesce(attempt_item.value->>'attempt_number', '') !~ '^[1-9][0-9]*$'
         or coalesce(attempt_item.value->>'nota', '') !~ '^[1-5]$'
    ) then
      raise exception using
        errcode = '22023',
        message = format('La materia %s contiene oportunidades inválidas.', v_materia);
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_attempts) as attempt_item(value)
      group by (attempt_item.value->>'attempt_number')::integer
      having count(*) > 1
    ) then
      raise exception using
        errcode = '22023',
        message = format('La materia %s contiene oportunidades duplicadas.', v_materia);
    end if;

    select min((attempt_item.value->>'attempt_number')::integer)
    into v_first_pass
    from jsonb_array_elements(v_attempts) as attempt_item(value)
    where (attempt_item.value->>'nota')::integer >= 2;

    if v_first_pass is not null and exists (
      select 1
      from jsonb_array_elements(v_attempts) as attempt_item(value)
      where (attempt_item.value->>'attempt_number')::integer > v_first_pass
    ) then
      raise exception using
        errcode = '22023',
        message = format('La materia %s contiene notas posteriores a una aprobación.', v_materia);
    end if;

    insert into public.student_note_attempts (
      user_id,
      materia,
      attempt_number,
      nota
    )
    select
      v_user_id,
      v_materia,
      (attempt_item.value->>'attempt_number')::integer,
      (attempt_item.value->>'nota')::smallint
    from jsonb_array_elements(v_attempts) as attempt_item(value)
    on conflict (user_id, materia, attempt_number)
    do update set
      nota = excluded.nota,
      updated_at = now();

    get diagnostics v_row_count = row_count;
    v_affected := v_affected + v_row_count;

    delete from public.student_note_attempts as stored
    where stored.user_id = v_user_id
      and stored.materia = v_materia
      and not exists (
        select 1
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = stored.attempt_number
      );

    get diagnostics v_row_count = row_count;
    v_deleted := v_deleted + v_row_count;

    insert into public.student_notes (
      user_id,
      materia,
      nota1,
      nota2,
      nota3,
      nota4,
      nota5,
      nota6,
      optativa_nombre
    )
    values (
      v_user_id,
      v_materia,
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 1
      ),
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 2
      ),
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 3
      ),
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 4
      ),
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 5
      ),
      (
        select (attempt_item.value->>'nota')::smallint
        from jsonb_array_elements(v_attempts) as attempt_item(value)
        where (attempt_item.value->>'attempt_number')::integer = 6
      ),
      v_optativa_nombre
    )
    on conflict (user_id, materia)
    do update set
      nota1 = excluded.nota1,
      nota2 = excluded.nota2,
      nota3 = excluded.nota3,
      nota4 = excluded.nota4,
      nota5 = excluded.nota5,
      nota6 = excluded.nota6,
      optativa_nombre = excluded.optativa_nombre;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'materials', jsonb_array_length(p_rows),
    'attempts_upserted', v_affected,
    'attempts_deleted', v_deleted
  );
end;
$$;

revoke all
on function public.save_student_note_attempts(jsonb)
from public;

grant execute
on function public.save_student_note_attempts(jsonb)
to authenticated;

comment on table public.student_note_attempts is
  'Oportunidades de notas finales del usuario, sin límite fijo por materia.';

comment on function public.save_student_note_attempts(jsonb) is
  'Guarda atómicamente oportunidades de notas y sincroniza nota1 a nota6 para compatibilidad.';

commit;
