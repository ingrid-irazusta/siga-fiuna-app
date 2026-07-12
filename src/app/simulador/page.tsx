"use client";

import SimuladorNotas from "@/components/SimuladorNotas";

export default function SimuladorPage() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <SimuladorNotas title="🧪 Simulador de Notas" mode="standalone" />
    </div>
  );
}
