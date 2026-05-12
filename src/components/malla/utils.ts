// =============================
// Tipos
// =============================

export type EstadoMateria = "aprobada" | "habilitada" | "bloqueada";

export interface MallaItem {
  key: string;              // identificador único (ej: MAT1)
  materia: string;          // nombre visible
  semestre: number;         // número de semestre
  requisitosKeys: string[]; // claves normalizadas de requisitos
}

export interface CalcEstadosParams {
  items: MallaItem[];
  aprobadasSet: Set<string>;
  strictMode?: boolean;          // reservado si querés lógica más estricta
  blockPlaceholders?: boolean;   // si true, también bloquea "SEGUN ..."
  radarTargetKey?: string | null; // reservado para overlays
  flashKeys?: string[];          // reservado para overlays
}

// =============================
// Normalizador de texto
// =============================

export function normText(s?: string | null): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// =============================
// Parseador de requisitos
// =============================

export function parseRequisitos(
  reqArr: string[] | string | null | undefined
): string[] {
  if (Array.isArray(reqArr)) {
    return reqArr
      .map((r) => String(r ?? "").trim())
      .filter(Boolean);
  }

  if (typeof reqArr === "string") {
    return reqArr
      .split(/[\n;]+|,(?![^\[]*\])/g)
      .map((r) => String(r ?? "").trim())
      .filter(Boolean);
  }

  return [];
}

// =============================
// Detectar placeholders
// =============================

export function isPlaceholderReq(reqNorm: string): boolean {
  return (
    reqNorm.startsWith("SEGUN ") ||
    reqNorm === "SEGUN REGLAMENTO" ||
    reqNorm === "SEGUN OPTATIVA"
  );
}

// =============================
// Calcular estados de materias
// =============================

export function calcEstados({
  items,
  aprobadasSet,
  strictMode = true,
  blockPlaceholders = false,
}: CalcEstadosParams): Map<string, EstadoMateria> {
  const estados = new Map<string, EstadoMateria>();
  const itemByKey = new Map<string, MallaItem>();
  const fulfillmentCache = new Map<string, boolean>();

  for (const it of items) {
    itemByKey.set(it.key, it);
  }

  const isRequisitoCumplido = (
    requisitoKey: string,
    path: Set<string>
  ): boolean => {
    if (aprobadasSet.has(requisitoKey)) {
      return true;
    }

    if (!blockPlaceholders && isPlaceholderReq(requisitoKey)) {
      return true;
    }

    if (fulfillmentCache.has(requisitoKey)) {
      return fulfillmentCache.get(requisitoKey)!;
    }

    if (path.has(requisitoKey)) {
      fulfillmentCache.set(requisitoKey, false);
      return false;
    }

    const requisitoItem = itemByKey.get(requisitoKey);
    if (!requisitoItem) {
      fulfillmentCache.set(requisitoKey, false);
      return false;
    }

    path.add(requisitoKey);
    for (const nestedKey of requisitoItem.requisitosKeys) {
      if (!blockPlaceholders && isPlaceholderReq(nestedKey)) continue;
      if (!isRequisitoCumplido(nestedKey, path)) {
        path.delete(requisitoKey);
        fulfillmentCache.set(requisitoKey, false);
        return false;
      }
    }
    path.delete(requisitoKey);

    fulfillmentCache.set(requisitoKey, true);
    return true;
  };

  for (const it of items) {
    const isAprobada = aprobadasSet.has(it.key);

    if (isAprobada) {
      estados.set(it.key, "aprobada");
      continue;
    }

    const missing: string[] = [];

    for (const requisitoKey of it.requisitosKeys) {
      if (!blockPlaceholders && isPlaceholderReq(requisitoKey)) continue;
      if (!isRequisitoCumplido(requisitoKey, new Set())) {
        missing.push(requisitoKey);
      }
    }

    estados.set(
      it.key,
      missing.length === 0 ? "habilitada" : "bloqueada"
    );
  }

  return estados;
}
