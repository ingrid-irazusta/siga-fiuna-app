-- Migración para actualizar la tabla student_notes con los campos faltantes
-- Ejecutar estos comandos en Supabase SQL Editor

-- 1. Agregar columnas nota4, nota5, nota6 si no existen
ALTER TABLE student_notes
ADD COLUMN IF NOT EXISTS nota4 INTEGER;

ALTER TABLE student_notes
ADD COLUMN IF NOT EXISTS nota5 INTEGER;

ALTER TABLE student_notes
ADD COLUMN IF NOT EXISTS nota6 INTEGER;

-- 2. Agregar columna optativa_nombre para guardar el nombre de las optativas
ALTER TABLE student_notes
ADD COLUMN IF NOT EXISTS optativa_nombre TEXT;

-- 3. (Opcional) Crear índice en user_id y materia para optimizar búsquedas
-- CREATE INDEX IF NOT EXISTS idx_student_notes_user_materia ON student_notes(user_id, materia);

-- Estructura esperada de la tabla student_notes:
-- - id: UUID (primary key)
-- - user_id: UUID (foreign key a auth.users)
-- - materia: TEXT (nombre real de la materia, ej: "Matemática I")
-- - nota1: INTEGER (1-5, nullable)
-- - nota2: INTEGER (1-5, nullable)
-- - nota3: INTEGER (1-5, nullable)
-- - nota4: INTEGER (1-5, nullable) - Para terceras instancias
-- - nota5: INTEGER (1-5, nullable) - Para cuartas instancias
-- - nota6: INTEGER (1-5, nullable) - Para quintas instancias
-- - optativa_nombre: TEXT (nullable) - Nombre de la optativa
-- - created_at: TIMESTAMP
-- - updated_at: TIMESTAMP

-- INSTRUCCIONES:
-- 1. Accede a tu proyecto Supabase
-- 2. Ve a la sección "SQL Editor"
-- 3. Copia y pega los comandos ALTER TABLE anteriores
-- 4. Ejecuta para agregar los campos faltantes
