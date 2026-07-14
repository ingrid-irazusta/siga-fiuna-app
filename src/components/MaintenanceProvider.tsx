"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import {
  canBypassMaintenance,
  isMaintenanceEnabled,
  maintenanceActionMessage,
  maintenanceDisabledMessage,
} from "@/lib/maintenance";

type MaintenanceContextValue = {
  isEnabled: boolean;
  isBypassUser: boolean;
  isRestricted: boolean;
  sessionResolved: boolean;
  userId: string | null;
  disabledMessage: string;
  actionMessage: string;
};

const MaintenanceContext = createContext<MaintenanceContextValue | null>(null);

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const enabled = isMaintenanceEnabled();

  useEffect(() => {
    if (!enabled) {
      setUserId(null);
      setSessionResolved(true);
      return;
    }

    let active = true;
    const supabase = getSupabase();

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUserId(data.session?.user.id || null);
      setSessionResolved(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUserId(session?.user.id || null);
      setSessionResolved(true);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [enabled]);

  const value = useMemo<MaintenanceContextValue>(() => {
    const bypass = enabled && canBypassMaintenance(userId);
    return {
      isEnabled: enabled,
      isBypassUser: bypass,
      isRestricted: enabled && (!sessionResolved || !bypass),
      sessionResolved,
      userId,
      disabledMessage: maintenanceDisabledMessage,
      actionMessage: maintenanceActionMessage,
    };
  }, [enabled, sessionResolved, userId]);

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

export function useMaintenanceMode(): MaintenanceContextValue {
  const context = useContext(MaintenanceContext);
  if (!context) throw new Error("useMaintenanceMode debe utilizarse dentro de MaintenanceProvider");
  return context;
}
