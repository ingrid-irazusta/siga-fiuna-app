import { CSSProperties, MouseEvent, ChangeEvent } from "react";

type Estado = "aprobada" | "habilitada" | "bloqueada" | string;

function estadoStyle(estado: Estado): CSSProperties {
  // Colores según prompt
  if (estado === "aprobada") return { background: "#A5D6A7" };
  if (estado === "habilitada") return { background: "#90CAF9" };
  if (estado === "bloqueada") return { background: "#EEEEEE" };
  return { background: "#EEEEEE" };
}

interface Materia {
  semestre: number;
  materia: string;
  requisitos: string[];
  key: string;
  requisitosKeys: string[];
  [key: string]: any;
}

interface MateriaCardProps {
  item: Materia;
  estado?: Estado;
  checked: boolean;
  onToggle: (item: Materia) => void;
  onOpen: (item: Materia) => void;
  radarActive?: boolean;
  flash?: boolean;
  ariaPrefix?: string;
}

export default function MateriaCard({
  item,
  estado,
  checked,
  onToggle,
  onOpen,
  radarActive,
  flash,
  ariaPrefix = "",
}: MateriaCardProps) {
  const style: CSSProperties = {
    ...estadoStyle(estado ?? ""),
    ...(radarActive || flash
      ? { outline: "2px solid rgba(255,193,7,0.9)", outlineOffset: 2 }
      : null),
  };

  return (
    <button
      type="button"
      className="mallaMateria"
      style={style}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onOpen(item);
      }}
      aria-label={`${ariaPrefix}${item.materia}`}
    >
      <div className="mallaMateriaTop">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            e.stopPropagation();
            onToggle(item);
          }}
          aria-label={`${ariaPrefix}Marcar ${item.materia}`}
          onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
        />
        <div className="mallaMateriaName">{item.materia}</div>
      </div>
    </button>
  );
}
