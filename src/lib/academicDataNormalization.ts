export function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeTextForMatching(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeSubjectName(value: unknown): string {
  return normalizeTextForMatching(value);
}

export function normalizeSection(value: unknown): string {
  const normalized = normalizeTextForMatching(value);
  return normalized === "—" || normalized === "-" ? "" : normalized;
}

export function normalizeClassType(value: unknown): "T" | "P" | "LAB" | "" {
  const normalized = normalizeTextForMatching(value).toUpperCase();
  if (!normalized) return "";
  if (normalized === "T" || normalized === "TEO" || normalized === "TEORIA") return "T";
  if (normalized === "P" || normalized === "PRAC" || normalized === "PRACTICA") return "P";
  if (normalized === "LAB" || normalized === "LABORATORIO") return "LAB";
  return "";
}

export function normalizeScheduleTime(value: unknown): string {
  const raw = normalizeWhitespace(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
