const MAINTENANCE_DISABLED_MESSAGE =
  "Esta función está temporalmente deshabilitada por mantenimiento.";

const MAINTENANCE_ACTION_MESSAGE =
  "Esta función estará disponible nuevamente cuando finalice la actualización.";

function maintenanceFlag(): string {
  return String(process.env.NEXT_PUBLIC_MAINTENANCE_MODE || "").trim().toLowerCase();
}

function bypassUserIds(): Set<string> {
  return new Set(
    String(process.env.NEXT_PUBLIC_MAINTENANCE_BYPASS_USER_IDS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isMaintenanceEnabled(): boolean {
  return maintenanceFlag() === "true";
}

export function canBypassMaintenance(userId?: string | null): boolean {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  return Boolean(normalizedUserId && bypassUserIds().has(normalizedUserId));
}

export function isMaintenanceRestricted(userId?: string | null): boolean {
  return isMaintenanceEnabled() && !canBypassMaintenance(userId);
}

export const maintenanceDisabledMessage = MAINTENANCE_DISABLED_MESSAGE;
export const maintenanceActionMessage = MAINTENANCE_ACTION_MESSAGE;
