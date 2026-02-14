"use client";

import MallaView from "../../components/malla/MallaView";
import MallaViewVertical from "../../components/malla/MallaViewVertical";
import { useEffect, useState } from "react";

const MALLA_VIEWMODE_KEY = "fiuna_os_malla_viewmode_v1"; // pc | celular

type ViewMode = "pc" | "celular";

export default function MallaPage() {
  // Selector interno (una sola pestaña):
  // - Modo PC: vista horizontal (semestres en columnas)
  // - Modo Celular: vista vertical/compacta
  const [viewMode, setViewMode] = useState<ViewMode>("pc");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MALLA_VIEWMODE_KEY);
      if (saved === "pc" || saved === "celular") setViewMode(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MALLA_VIEWMODE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  return (
    <div className="mallaPageWrap">
      <div className="mallaModeBar" aria-label="Selector de vista">
        <div className="mallaModeTitle">Vista</div>
        <div className="mallaSeg">
          <button
            type="button"
            className={`mallaSegBtn ${viewMode === "pc" ? "on" : ""}`}
            onClick={() => setViewMode("pc")}
          >
            Modo PC
          </button>
          <button
            type="button"
            className={`mallaSegBtn ${viewMode === "celular" ? "on" : ""}`}
            onClick={() => setViewMode("celular")}
          >
            Modo Celular
          </button>
        </div>
      </div>

      {viewMode === "pc" ? <MallaView /> : <MallaViewVertical />}
    </div>
  );
}
