import MateriaCard from "./MateriaCard";

interface MateriaItem {
  semestre: number;
  materia: string;
  requisitos: string[];
  key: string;
  requisitosKeys: string[];
  [key: string]: any;
}

interface SemestreColumnProps {
  semestre: number;
  items: MateriaItem[];
  estados: Map<string, any>;
  aprobadasSet: Set<string>;
  onToggle: (item: MateriaItem) => void;
  onOpen: (item: MateriaItem) => void;
  radarKeys: Set<string>;
  flashKeys: Set<string>;
}

export default function SemestreColumn({
  semestre,
  items,
  estados,
  aprobadasSet,
  onToggle,
  onOpen,
  radarKeys,
  flashKeys,
}: SemestreColumnProps) {
  return (
    <div className="mallaSemestre">
      <div className="mallaSemestreHeader">
        <div style={{ fontWeight: 900 }}>{semestre}° semestre</div>
      </div>

      <div className="mallaSemestreList">
        {items.map((it) => (
          <MateriaCard
            key={it.key}
            item={it}
            estado={estados.get(it.key)}
            checked={aprobadasSet.has(it.key)}
            onToggle={onToggle}
            onOpen={onOpen}
            radarActive={radarKeys.has(it.key)}
            flash={flashKeys.has(it.key)}
          />
        ))}
      </div>
    </div>
  );
}
