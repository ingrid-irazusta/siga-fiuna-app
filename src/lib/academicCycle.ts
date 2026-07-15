const PARAGUAY_TIME_ZONE = "America/Asuncion";

export type AcademicCycle = {
  key: string;
  number: 1 | 2;
  year: number;
  label: string;
};

export function getCurrentAcademicCycle(date: Date = new Date()): AcademicCycle {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("La fecha del ciclo académico no es válida.");
  }

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARAGUAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);

  const year = Number(dateParts.find((part) => part.type === "year")?.value);
  const month = Number(dateParts.find((part) => part.type === "month")?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError("No se pudo determinar el ciclo académico actual.");
  }

  const number: 1 | 2 = month <= 6 ? 1 : 2;

  return {
    key: `${year}-${number}`,
    number,
    year,
    label: `${number}° ${year}`,
  };
}
