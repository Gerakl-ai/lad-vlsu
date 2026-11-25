# -*- coding: utf-8 -*-
"""Финальный Word-отчёт: Лад ВлГУ (прод + исходный репозиторий)."""
import json
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

DIR = Path(__file__).resolve().parent
OUT = DIR / "Лад-ВлГУ-финальный-аудит-и-тестирование.docx"
BUGS_JSON = DIR / "lad-bugs-master.json"
SEV_COLOR = {
    "Critical": "FF6B6B",
    "High": "FFB347",
    "Medium": "FFE08A",
    "Low": "E8E8E8",
    "Info": "D4E8FF",
}


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._element.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_doc_defaults(doc: Document) -> None:
    style = doc.styles["Normal"]
    font = style.font
    font.name = "Times New Roman"
    font.size = Pt(12)
    style._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")


def add_para(doc: Document, text: str, bold: bool = False) -> None:
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold


def add_table(
    doc: Document,
    headers: list[str],
    rows: list[list[str]],
    col_widths: list[float] | None = None,
    sev_col: int | None = None,
) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0].cells
    for i, text in enumerate(headers):
        hdr[i].text = text
        for p in hdr[i].paragraphs:
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(10)
        set_cell_shading(hdr[i], "D0D0D0")
    for row in rows:
        cells = table.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = text
            for p in cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(9)
            if sev_col is not None and i == sev_col and text in SEV_COLOR:
                set_cell_shading(cells[i], SEV_COLOR[text])
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                if i < len(row.cells):
                    row.cells[i].width = Cm(w)
    doc.add_paragraph()


def add_bug_detail_block(doc: Document, bug: dict) -> None:
    doc.add_heading(f"{bug['id']} — {bug['title']}", level=3)
    t = doc.add_paragraph()
    t.add_run(f"Критичность: {bug['sev']}. ").bold = True
    t.add_run(f"Область: {bug.get('area', '—')}.")
    add_para(doc, bug.get("detail", ""))
    if bug.get("repro"):
        p = doc.add_paragraph()
        p.add_run("Воспроизведение: ").bold = True
        p.add_run(bug["repro"])
    if bug.get("expected"):
        p = doc.add_paragraph()
        p.add_run("Ожидание: ").bold = True
        p.add_run(bug["expected"])
    if bug.get("evidence"):
        p = doc.add_paragraph()
        p.add_run("Доказательство: ").italic = True
        p.add_run(bug["evidence"])


def main() -> None:
    data = json.loads(BUGS_JSON.read_text(encoding="utf-8"))
    meta = data["meta"]
    lad = data["ladBugs"]
    repo = data.get("repoBugs", [])
    tr = meta.get("testResults", {})

    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(2.5)
        section.right_margin = Cm(1.5)
    set_doc_defaults(doc)

    for _ in range(3):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("ФИНАЛЬНЫЙ ОТЧЁТ\nПО АУДИТУ И ТЕСТИРОВАНИЮ")
    r.bold = True
    r.font.size = Pt(18)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Веб-приложение «Лад ВлГУ»")
    r.font.size = Pt(16)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(meta["productUrl"] + "\n")
    p.add_run(f"Дата: {meta['auditedAt']}\n")
    p.add_run(f"Release (прод): {meta['release']}\n")
    p.add_run(f"Коммит репозитория: {meta.get('repoCommit', '—')}\n")
    p.add_run("Статус: инвентаризация и тестирование; исправления не вносились.")
    doc.add_page_break()

    doc.add_heading("0. Объект и репозиторий", level=1)
    add_para(doc, meta["workspaceNote"])
    add_para(
        doc,
        "Проверены: опубликованное приложение, статические данные на CDN, исходники в репозитории lad-vlsu, "
        "локальная сборка dist + preview, юнит-тесты, выборочные Playwright-сценарии, HTTP-аудит.",
    )

    doc.add_heading("1. Резюме", level=1)
    crit = sum(1 for b in lad if b["sev"] == "Critical")
    high = sum(1 for b in lad if b["sev"] == "High")
    add_para(
        doc,
        f"Дефекты продакшена (LAD): {len(lad)} (Critical: {crit}, High: {high}). "
        f"Замечания по CI/окружению (REP): {len(repo)}.",
    )
    add_para(
        doc,
        "Вывод: статический слой данных и клиентский код в репозитории зрелые (583 автотеста). "
        "Главный разрыв — деплой: на germanpolkin.ru нет /vlsu-api и /app-api, хотя прокси реализован в functions/ "
        "и работает на vite preview. Live-обновление уходит на workers.dev с риском устаревших снимков.",
    )
    add_table(
        doc,
        ["Приоритет", "Действие"],
        [
            ["P0", "Развернуть прокси на том же origin, что и PWA (LAD-001, 002, 024)"],
            ["P0", "Согласовать refresh: static vs Worker cached (LAD-003, 004)"],
            ["P1", "Desktop/laptop вёрстка (LAD-VIS-01…03) + qa-desktop-layout"],
            ["P1", "A11y: h1, контраст табов, zoom (LAD-007…010)"],
            ["P1", "PWA shortcuts и двойные модалки (LAD-013, 014)"],
            ["P2", "university-schedule.json 3.47 MB; CSP на GH Pages"],
        ],
        [2.5, 13],
    )

    doc.add_heading("2. Методология", level=1)
    for item in [
        "pnpm run test — Vitest (логика данных, SW, PDF pipeline).",
        "pnpm run build — tsc + vite; node --check public/sw.js.",
        "Playwright: qa-lesson-selection, qa-university-cache-race, qa-desktop-layout (390×844), частично group-startup.",
        "HTTP: lad-full-bug-audit.mjs, lad-coverage-scan.mjs (739 HEAD schedule).",
        "Браузер: smoke на germanpolkin.ru, ПИ-124, accessibility tree.",
        "Сверка preview :4173/vlsu-api с продом.",
    ]:
        doc.add_paragraph(item, style="List Bullet")

    doc.add_heading("3. Результаты автотестов репозитория", level=1)
    rows = [[k, str(v)] for k, v in tr.items()]
    add_table(doc, ["Проверка", "Результат"], rows, [5, 10])

    doc.add_heading("4. Реестр дефектов продакшена (LAD)", level=1)
    add_table(
        doc,
        ["ID", "Крит.", "Область", "Краткое название"],
        [[b["id"], b["sev"], b.get("area", ""), b["title"]] for b in lad],
        [2, 2, 2.5, 10.5],
        sev_col=1,
    )
    doc.add_page_break()
    doc.add_heading("4.1. Подробности LAD", level=2)
    for b in lad:
        if b["sev"] == "Info":
            continue
        add_bug_detail_block(doc, b)

    doc.add_heading("5. Архитектура и цепочки", level=1)
    add_table(
        doc,
        ["Компонент", "Поведение", "Статус 25.11"],
        [
            ["Статика schedule", "739/739 HEAD 200", "Pass"],
            ["university-schedule.json", "~3.47 MB", "Pass, perf risk"],
            ["/vlsu-api (прод)", "germanpolkin.ru", "Fail 404"],
            ["/vlsu-api (preview)", "vite proxy :4173", "Pass JSON"],
            ["/app-api (прод)", "health/schedule", "Fail 404"],
            ["Cloudflare Worker", "vlsu-pi-124-schedule…", "200, cached риск"],
            ["PWA", "release 9859da8", "Активен"],
        ],
        [4.5, 5.5, 5.5],
    )

    doc.add_heading("5.1. Масштаб и ноутбуки (доп. проверка)", level=2)
    add_table(
        doc,
        ["ID", "Крит.", "Суть"],
        [
            ["LAD-VIS-01", "High", "Desktop Сегодня: колонка detail длиннее summary"],
            ["LAD-VIS-02", "Medium", "Неделя: week-overview шире viewport"],
            ["LAD-VIS-03", "High", "qa-desktop-layout fail на 1024–1920"],
            ["LAD-009", "Medium", "Отключён pinch-zoom (meta viewport)"],
        ],
        [2.5, 2, 12],
        sev_col=1,
    )
    add_para(
        doc,
        "Горизонтальный scroll страницы на ноутбуках не выявлен; дефекты — внутри CSS-grid. "
        "Скрипт measure-viewport-layout.mjs; gate до прода — PRE-PROD-RELEASE-GATE.md.",
    )

    doc.add_heading("6. Матрица тестирования (финальный прогон)", level=1)
    add_table(
        doc,
        ["Категория", "Сценарий", "Результат"],
        [
            ["Unit", "Vitest 583 тестов", "Pass"],
            ["Build", "tsc + vite build", "Pass"],
            ["SW", "node --check sw.js", "Pass"],
            ["Data", "739 schedule HEAD", "Pass"],
            ["Data", "catalog/coverage/quality", "Pass"],
            ["Backend", "/vlsu-api прод", "Fail"],
            ["Backend", "/vlsu-api preview", "Pass"],
            ["E2E", "lesson-selection", "Pass"],
            ["E2E", "university-cache-race", "Pass"],
            ["E2E", "desktop 390×844", "Pass"],
            ["E2E", "group-startup (full)", "Partial / crash"],
            ["UX/A11y", "h1 «ПИ -124» в a11y-tree", "Fail LAD-007"],
            ["Prod UI", "Сегодня ПИ-124", "Pass"],
        ],
        [2.5, 5.5, 7.5],
    )

    doc.add_heading("7. Замечания CI и окружения (REP)", level=1)
    add_table(
        doc,
        ["ID", "Крит.", "Область", "Название"],
        [[b["id"], b["sev"], b.get("area", ""), b["title"]] for b in repo],
        [2, 2, 2.5, 10.5],
        sev_col=1,
    )

    doc.add_heading("8. План до прода (волны)", level=1)
    add_para(
        doc,
        "Волна A — репозиторий: VIS + a11y + UX, preview. Волна B — деплой /vlsu-api. "
        "Полный реестр без деплоя закрыть нельзя.",
    )
    add_table(
        doc,
        ["Этап", "Задачи", "Критерий"],
        [
            ["A", "LAD-VIS, LAD-007…016", "qa-desktop-layout + measure-viewport"],
            ["Gate", "pnpm test/build + QA", "PRE-PROD-RELEASE-GATE.md"],
            ["B", "Деплой прокси", "/vlsu-api 200 на домене"],
            ["C", "Refresh merge", "LAD-004"],
            ["Данные", "missing 225", "snapshot-цикл"],
        ],
        [1.2, 7, 7.3],
    )

    doc.add_heading("9. Приложения", level=1)
    for item in [
        "lad-vlsu-audit-i-testirovanie.md — текст отчёта.",
        "lad-bugs-master.json — реестр LAD + REP.",
        "lad-bugs-automated.json — HTTP-аудит.",
        "PRE-PROD-RELEASE-GATE.md — чек-лист до выкладки.",
        "measure-viewport-layout.mjs — масштаб laptop/desktop.",
        "lad-coverage-scan.mjs, lad-full-bug-audit.mjs, build-lad-word-report.py.",
    ]:
        doc.add_paragraph(item, style="List Bullet")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run(f"Сгенерировано: {meta['auditedAt']}")
    run.italic = True
    run.font.color.rgb = RGBColor(90, 90, 90)

    doc.save(OUT)
    print(f"Saved: {OUT}")


if __name__ == "__main__":
    main()