import { canBypassMaintenance } from "@/lib/maintenance";

type SearchParamsReader = Pick<URLSearchParams, "get">;

export function isFirstUseDemoRequested(searchParams: SearchParamsReader): boolean {
  return searchParams.get("demo") === "first-use";
}

export function canUseFirstUseDemo(
  searchParams: SearchParamsReader,
  userId?: string | null
): boolean {
  return isFirstUseDemoAuthorized(isFirstUseDemoRequested(searchParams), userId);
}

export function isFirstUseDemoAuthorized(
  requested: boolean,
  userId?: string | null
): boolean {
  return requested && canBypassMaintenance(userId);
}
