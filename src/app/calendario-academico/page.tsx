"use client";

export default function CalendarioAcademicoPage() {
  const fiunaPage: string =
    "https://www.ing.una.py/FIUNA3/?page_id=232";

  const embedUrl: string =
    "https://calendar.google.com/calendar/embed?src=fiunapy%40gmail.com&ctz=America%2FAsuncion";

  return (
    <div className="grid">
      <div
        className="pageTitleRow"
        style={{ justifyContent: "flex-end" }}
      >
        <a
          className="btnPrimary"
          href={fiunaPage}
          target="_blank"
          rel="noreferrer"
        >
          Ver publicación FIUNA ↗
        </a>
      </div>

      <section
        className="card"
        style={{ overflow: "hidden" }}
      >
        <iframe
          title="Calendario académico FIUNA"
          src={embedUrl}
          style={{
            width: "100%",
            height: "72vh",
            border: 0,
          }}
          scrolling="no"
        />
      </section>
    </div>
  );
}
