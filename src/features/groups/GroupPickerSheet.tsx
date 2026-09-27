import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  RefreshCw,
  Search,
  Share2,
  Star,
  UsersRound,
  WifiOff,
  X
} from "lucide-react";
import { loadGroups, loadInstitutes, normalizeCachedSchedule } from "../../lib/scheduleApi";
import { loadStaticCoverage, type StaticCoverage } from "../../lib/staticData";
import { dateKeyFromDate } from "../../lib/time";
import {
  readFavoriteGroups,
  readGroupCatalog,
  readGroupScheduleCache,
  readInstituteCatalog,
  writeGroupCatalog,
  toggleFavoriteGroup,
  writeInstituteCatalog
} from "./groupStorage";
import { groupLinkUrl } from "./groupLinks";
import {
  LEGACY_PI124_GROUP,
  studyFormLabel,
  toGroupProfile,
  type GroupOption,
  type GroupProfile,
  type InstituteOption
} from "./groupTypes";

interface GroupPickerSheetProps {
  open: boolean;
  selectedGroup: GroupProfile | null;
  onClose: () => void;
  onSelect: (group: GroupProfile) => void;
}

type CatalogStatus = "idle" | "loading" | "ready" | "stale";

function normalizedSearch(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function matchesSearch(values: Array<string | undefined>, query: string) {
  const normalized = normalizedSearch(query);
  if (!normalized) return true;
  return values.some((value) => normalizedSearch(value ?? "").includes(normalized));
}

function snapshotLabel(coverage: StaticCoverage | null, nrec: string) {
  const entry = coverage?.groups[nrec];
  const capturedAt = entry?.capturedAt;
  if (entry?.validThrough && entry.validThrough < dateKeyFromDate()) {
    return `Архив до ${new Date(`${entry.validThrough}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
  }
  if (capturedAt) return `Есть данные от ${new Date(capturedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
  return coverage ? "Данных пока нет" : null;
}

export function GroupPickerSheet({ open, selectedGroup, onClose, onSelect }: GroupPickerSheetProps) {
  const [institutes, setInstitutes] = useState<InstituteOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [activeInstitute, setActiveInstitute] = useState<InstituteOption | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CatalogStatus>("idle");
  const [favoriteGroups, setFavoriteGroups] = useState<GroupProfile[]>(() => readFavoriteGroups());
  const [shareState, setShareState] = useState<"idle" | "done" | "error">("idle");
  const [coverage, setCoverage] = useState<StaticCoverage | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuery("");
    setActiveInstitute(null);
    setGroups([]);
    setFavoriteGroups(readFavoriteGroups());
    setShareState("idle");
    void loadStaticCoverage().then((result) => {
      if (!cancelled) setCoverage(result);
    }).catch(() => {
      if (!cancelled) setCoverage(null);
    });

    const cached = readInstituteCatalog();
    if (cached?.items.length) {
      setInstitutes(cached.items);
      setStatus("ready");
    } else {
      setStatus("loading");
    }

    void loadInstitutes()
      .then((items) => {
        if (cancelled || !items.length) return;
        setInstitutes(items);
        writeInstituteCatalog(items);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("stale");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !activeInstitute) return;
    let cancelled = false;
    const cached = readGroupCatalog(activeInstitute.id);
    setGroups(cached?.items ?? []);
    setStatus(cached?.items.length ? "ready" : "loading");

    void loadGroups(activeInstitute.id)
      .then((items) => {
        if (cancelled || !items.length) return;
        setGroups(items);
        writeGroupCatalog(activeInstitute.id, items);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("stale");
      });

    return () => {
      cancelled = true;
    };
  }, [activeInstitute, open]);

  const filteredInstitutes = useMemo(
    () => institutes.filter((institute) => matchesSearch([institute.name, institute.shortName], query)),
    [institutes, query]
  );
  const filteredGroups = useMemo(
    () => groups.filter((group) => matchesSearch([group.name, group.course], query)),
    [groups, query]
  );

  if (!open) return null;

  const chooseInstitute = (institute: InstituteOption) => {
    setQuery("");
    setActiveInstitute(institute);
  };

  const chooseGroup = (group: GroupOption) => {
    if (!activeInstitute) return;
    onSelect(toGroupProfile(activeInstitute, group));
  };

  const canClose = Boolean(selectedGroup);
  const rows = activeInstitute ? filteredGroups : filteredInstitutes;
  const showCoverageWarning = Boolean(coverage && coverage.available < coverage.catalogGroups);

  const toggleFavorite = (event: React.MouseEvent, group: GroupProfile) => {
    event.stopPropagation();
    setFavoriteGroups(toggleFavoriteGroup(group));
  };

  const shareSelectedGroup = async () => {
    if (!selectedGroup) return;
    const url = groupLinkUrl(selectedGroup, window.location.href);
    try {
      if (navigator.share) await navigator.share({ title: `${selectedGroup.name} · Лад ВлГУ`, url });
      else await navigator.clipboard.writeText(url);
      setShareState("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareState("error");
    }
  };

  return (
    <div className="group-picker-backdrop" role="presentation" data-first-run={!selectedGroup}>
      <section className={`group-picker-sheet${showCoverageWarning ? " has-coverage" : ""}`} role="dialog" aria-modal="true" aria-labelledby="group-picker-title">
        <header className="group-picker-header">
          {activeInstitute ? (
            <button type="button" className="group-picker-icon" onClick={() => { setActiveInstitute(null); setQuery(""); }} aria-label="Назад к институтам">
              <ArrowLeft size={20} />
            </button>
          ) : <span className="group-picker-logo"><Building2 size={20} /></span>}
          <div>
            <small>{activeInstitute ? activeInstitute.shortName : "Лад ВлГУ"}</small>
            <h2 id="group-picker-title">{activeInstitute ? "Выберите группу" : selectedGroup ? "Сменить институт" : "Найдите свою группу"}</h2>
          </div>
          {canClose ? (
            <button type="button" className="group-picker-icon" onClick={onClose} aria-label="Закрыть выбор группы">
              <X size={20} />
            </button>
          ) : <span className="group-picker-icon-placeholder" />}
        </header>

        <label className="group-picker-search">
          <Search size={19} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={activeInstitute ? "Название группы или курс" : "Название или сокращение института"}
            autoComplete="off"
            autoCapitalize="characters"
          />
          {status === "loading" && <RefreshCw className="spin" size={17} aria-label="Загрузка каталога" />}
        </label>

        <div className="group-picker-context">
          <span>{activeInstitute ? activeInstitute.name : "Институты ВлГУ"}</span>
          <strong>{rows.length}</strong>
        </div>
        {coverage && showCoverageWarning && (
          <p className="group-picker-coverage">
            На сервере сохранено расписание для {coverage.available} из {coverage.catalogGroups} групп. Для остальных данных пока нет.
          </p>
        )}

        <div className="group-picker-list" data-screen-swipe="ignore">
          {!activeInstitute && !query && favoriteGroups.length > 0 && (
            <section className="favorite-groups" aria-label="Избранные группы">
              <strong className="favorite-groups-title"><Star size={13} fill="currentColor" /> Избранные</strong>
              {favoriteGroups.map((group) => (
                <div className="group-picker-row-wrap" key={`favorite-${group.nrec}`}>
                  <button type="button" className="group-picker-row group-row" onClick={() => onSelect(group)}>
                    <span className="group-badge"><UsersRound size={19} /></span>
                    <span className="group-picker-copy"><strong>{group.name}</strong><small>{[group.instituteShortName, group.course, normalizeCachedSchedule(readGroupScheduleCache(group)) ? "Сохранено здесь" : snapshotLabel(coverage, group.nrec)].filter(Boolean).join(" · ")}</small></span>
                    {selectedGroup?.nrec === group.nrec ? <Check size={20} className="group-picker-check" /> : <ChevronRight size={20} />}
                  </button>
                  <button type="button" className="group-favorite-button active" onClick={(event) => toggleFavorite(event, group)} aria-label={`Убрать ${group.name} из избранного`} title="Убрать из избранного">
                    <Star size={18} fill="currentColor" />
                  </button>
                </div>
              ))}
            </section>
          )}

          {!activeInstitute && filteredInstitutes.map((institute) => (
            <button key={institute.id} type="button" className="group-picker-row" onClick={() => chooseInstitute(institute)}>
              <span className="institute-badge" data-visual={institute.visualKey}>{institute.shortName}</span>
              <span className="group-picker-copy"><strong>{institute.name}</strong></span>
              <ChevronRight size={20} />
            </button>
          ))}

          {activeInstitute && filteredGroups.map((group) => {
            const isCurrent = selectedGroup?.nrec === group.nrec;
            const profile = toGroupProfile(activeInstitute, group);
            const isFavorite = favoriteGroups.some((item) => item.nrec === group.nrec);
            const savedOffline = Boolean(normalizeCachedSchedule(readGroupScheduleCache(profile)));
            const availability = savedOffline ? "Сохранено здесь" : snapshotLabel(coverage, group.nrec);
            return (
              <div className="group-picker-row-wrap" key={group.nrec}>
                <button type="button" className="group-picker-row group-row" onClick={() => chooseGroup(group)}>
                  <span className="group-badge"><UsersRound size={19} /></span>
                  <span className="group-picker-copy"><strong>{group.name}</strong><small>{[group.course ?? activeInstitute.shortName, studyFormLabel(group.forms), availability].filter(Boolean).join(" · ")}</small></span>
                  {isCurrent ? <Check size={20} className="group-picker-check" /> : <ChevronRight size={20} />}
                </button>
                <button type="button" className={`group-favorite-button ${isFavorite ? "active" : ""}`} onClick={(event) => toggleFavorite(event, profile)} aria-label={`${isFavorite ? "Убрать" : "Добавить"} ${group.name} ${isFavorite ? "из" : "в"} избранное`} title={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}>
                  <Star size={18} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}

          {!rows.length && status !== "loading" && (
            <div className="group-picker-empty">
              <WifiOff size={24} />
              <strong>{query ? "Ничего не найдено" : "Каталог пока недоступен"}</strong>
              <p>{query ? "Проверьте название или вернитесь к выбору института." : "ВлГУ не ответил. Сохранённые варианты останутся доступны офлайн."}</p>
              {!selectedGroup && !activeInstitute && (
                <button type="button" onClick={() => onSelect(LEGACY_PI124_GROUP)}>Открыть ПИ-124</button>
              )}
            </div>
          )}
        </div>

        <footer className="group-picker-footer">
          <span className="group-picker-footer-status"><span className={`catalog-dot catalog-${status}`} />
            {shareState === "done" ? "Ссылка скопирована" : shareState === "error" ? "Не удалось поделиться" : status === "stale" ? "Показан сохранённый каталог" : status === "loading" ? "Загружаем каталог" : "Выбор сохранится на устройстве"}
          </span>
          {selectedGroup && (
            <button type="button" className="group-share-button" onClick={shareSelectedGroup} aria-label={`Поделиться расписанием группы ${selectedGroup.name}`} title="Поделиться группой">
              <Share2 size={16} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
