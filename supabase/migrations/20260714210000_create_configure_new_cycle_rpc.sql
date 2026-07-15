begin;

create or replace function public.configure_new_cycle(
  p_courses jsonb,
  p_classes jsonb,
  p_carrera text,
  p_malla text,
  p_update_carrera boolean default false,
  p_update_malla boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();

  v_current_carrera text;
  v_current_malla text;

  v_deleted_courses integer := 0;
  v_deleted_classes integer := 0;
  v_deleted_processes integer := 0;
  v_deleted_exams integer := 0;

  v_inserted_courses integer := 0;
  v_inserted_classes integer := 0;
  v_profile_rows integer := 0;

  v_update_carrera boolean := coalesce(p_update_carrera, false);
  v_update_malla boolean := coalesce(p_update_malla, false);
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Debes iniciar sesión para configurar un nuevo ciclo.';
  end if;

  -- Serializa configuraciones simultáneas del mismo usuario.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text, 0)
  );

  if p_courses is null or jsonb_typeof(p_courses) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'La lista de materias no es válida.';
  end if;

  if jsonb_array_length(p_courses) = 0 then
    raise exception using
      errcode = '22023',
      message = 'Debes seleccionar al menos una materia.';
  end if;

  if jsonb_array_length(p_courses) > 100 then
    raise exception using
      errcode = '22023',
      message = 'La cantidad de materias excede el límite permitido.';
  end if;

  if p_classes is null or jsonb_typeof(p_classes) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'La lista de clases no es válida.';
  end if;

  if jsonb_array_length(p_classes) = 0 then
    raise exception using
      errcode = '22023',
      message = 'Debes seleccionar al menos una clase.';
  end if;

  if jsonb_array_length(p_classes) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'La cantidad de clases excede el límite permitido.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_courses) as c(course_item)
    where jsonb_typeof(c.course_item) <> 'object'
       or coalesce(btrim(c.course_item->>'materia'), '') = ''
       or jsonb_typeof(
            coalesce(c.course_item->'tipos', '[]'::jsonb)
          ) <> 'array'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Una o más materias tienen datos inválidos.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_courses) as c(course_item)
    cross join lateral jsonb_array_elements(
      coalesce(c.course_item->'tipos', '[]'::jsonb)
    ) as t(type_item)
    where jsonb_typeof(t.type_item) <> 'string'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Los tipos de clase de una materia no son válidos.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_courses)
  ) <> (
    select count(
      distinct lower(btrim(c.course_item->>'materia'))
    )
    from jsonb_array_elements(p_courses) as c(course_item)
  ) then
    raise exception using
      errcode = '22023',
      message = 'La lista contiene materias duplicadas.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_classes) as c(class_item)
    where jsonb_typeof(c.class_item) <> 'object'
       or coalesce(btrim(c.class_item->>'materia'), '') = ''
       or coalesce(btrim(c.class_item->>'tipo'), '') not in (
            'T',
            'P',
            'LAB'
          )
       or coalesce(c.class_item->>'day_id', '') !~ '^[1-6]$'
       or coalesce(btrim(c.class_item->>'inicio'), '')
            !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
       or coalesce(btrim(c.class_item->>'fin'), '')
            !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Una o más clases tienen datos inválidos.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_classes) as cl(class_item)
    where not exists (
      select 1
      from jsonb_array_elements(p_courses) as co(course_item)
      where btrim(co.course_item->>'materia')
          = btrim(cl.class_item->>'materia')
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'El horario contiene clases de una materia no seleccionada.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_courses) as co(course_item)
    where not exists (
      select 1
      from jsonb_array_elements(p_classes) as cl(class_item)
      where btrim(cl.class_item->>'materia')
          = btrim(co.course_item->>'materia')
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Todas las materias deben tener al menos una clase seleccionada.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_classes) as cl(class_item)
    group by
      btrim(cl.class_item->>'materia'),
      btrim(cl.class_item->>'tipo'),
      btrim(coalesce(cl.class_item->>'seccion', '')),
      cl.class_item->>'day_id',
      btrim(cl.class_item->>'inicio'),
      btrim(cl.class_item->>'fin')
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'El horario contiene clases duplicadas.';
  end if;

  select carrera, malla
  into v_current_carrera, v_current_malla
  from public.user_profiles
  where user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No se encontró el perfil del usuario.';
  end if;

  if coalesce(btrim(p_carrera), '') = '' then
    raise exception using
      errcode = '22023',
      message = 'La carrera seleccionada no es válida.';
  end if;

  if coalesce(btrim(p_malla), '') = '' then
    raise exception using
      errcode = '22023',
      message = 'La malla seleccionada no es válida.';
  end if;

  if not v_update_carrera
     and btrim(p_carrera) is distinct from btrim(v_current_carrera) then
    raise exception using
      errcode = '22023',
      message = 'El cambio de carrera debe confirmarse explícitamente.';
  end if;

  if not v_update_malla
     and btrim(p_malla) is distinct from btrim(v_current_malla) then
    raise exception using
      errcode = '22023',
      message = 'El cambio de malla debe confirmarse explícitamente.';
  end if;

  if v_update_carrera or v_update_malla then
    update public.user_profiles
    set
      carrera = case
        when v_update_carrera then btrim(p_carrera)
        else carrera
      end,
      malla = case
        when v_update_malla then btrim(p_malla)
        else malla
      end,
      updated_at = now()
    where user_id = v_user_id;

    get diagnostics v_profile_rows = row_count;

    if v_profile_rows <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'No se pudo actualizar el perfil del usuario.';
    end if;
  end if;

  delete from public.student_processes
  where user_id = v_user_id;

  get diagnostics v_deleted_processes = row_count;

  delete from public.student_exams
  where user_id = v_user_id;

  get diagnostics v_deleted_exams = row_count;

  delete from public.student_classes
  where user_id = v_user_id;

  get diagnostics v_deleted_classes = row_count;

  delete from public.student_courses
  where user_id = v_user_id;

  get diagnostics v_deleted_courses = row_count;

  insert into public.student_courses (
    user_id,
    semestre,
    materia,
    firma,
    tipos
  )
  select
    v_user_id,
    nullif(btrim(c.course_item->>'semestre'), ''),
    btrim(c.course_item->>'materia'),
    nullif(btrim(c.course_item->>'firma'), ''),
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(c.course_item->'tipos', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    )
  from jsonb_array_elements(p_courses) as c(course_item);

  get diagnostics v_inserted_courses = row_count;

  if v_inserted_courses <> jsonb_array_length(p_courses) then
    raise exception using
      errcode = 'P0001',
      message = 'No se pudieron insertar todas las materias.';
  end if;

  insert into public.student_classes (
    user_id,
    day_id,
    materia,
    tipo,
    seccion,
    inicio,
    fin,
    prof
  )
  select
    v_user_id,
    (cl.class_item->>'day_id')::integer,
    btrim(cl.class_item->>'materia'),
    btrim(cl.class_item->>'tipo'),
    nullif(btrim(cl.class_item->>'seccion'), ''),
    cast(
      btrim(cl.class_item->>'inicio')
      as time without time zone
    ),
    cast(
      btrim(cl.class_item->>'fin')
      as time without time zone
    ),
    nullif(btrim(cl.class_item->>'prof'), '')
  from jsonb_array_elements(p_classes) as cl(class_item);

  get diagnostics v_inserted_classes = row_count;

  if v_inserted_classes <> jsonb_array_length(p_classes) then
    raise exception using
      errcode = 'P0001',
      message = 'No se pudieron insertar todas las clases.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'carrera', case
      when v_update_carrera then btrim(p_carrera)
      else v_current_carrera
    end,
    'malla', case
      when v_update_malla then btrim(p_malla)
      else v_current_malla
    end,
    'profile_updated', v_update_carrera or v_update_malla,
    'deleted', jsonb_build_object(
      'student_courses', v_deleted_courses,
      'student_classes', v_deleted_classes,
      'student_processes', v_deleted_processes,
      'student_exams', v_deleted_exams
    ),
    'inserted', jsonb_build_object(
      'student_courses', v_inserted_courses,
      'student_classes', v_inserted_classes
    )
  );
end;
$$;

revoke all
on function public.configure_new_cycle(
  jsonb,
  jsonb,
  text,
  text,
  boolean,
  boolean
)
from public;

grant execute
on function public.configure_new_cycle(
  jsonb,
  jsonb,
  text,
  text,
  boolean,
  boolean
)
to authenticated;

comment on function public.configure_new_cycle(
  jsonb,
  jsonb,
  text,
  text,
  boolean,
  boolean
)
is
  'Reemplaza atómicamente los datos activos del ciclo académico del usuario autenticado sin modificar notas finales ni materias aprobadas.';

commit;
