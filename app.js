const STORAGE_KEY = "dog-draw-roster-v2";
const SHEET_URL_KEY = "dog-draw-sheet-url";
const DRAW_MODE_KEY = "dog-draw-mode";

/**
 * @typedef {{
 *   id: string,
 *   fio: string,
 *   breed: string,
 *   dog: string,
 *   className: string
 * }} Participant
 *
 * @typedef {{
 *   className: string,
 *   ordered: Participant[]
 * }} DrawGroup
 */

/** @type {Participant[]} */
let roster = loadRoster();
/** @type {DrawGroup[]} */
let lastDrawGroups = [];
let drawing = false;

const els = {
  sheetUrl: document.getElementById("sheet-url"),
  loadSheet: document.getElementById("load-sheet"),
  file: document.getElementById("file-input"),
  paste: document.getElementById("paste-btn"),
  tableInput: document.getElementById("table-input"),
  loadTable: document.getElementById("load-table"),
  clear: document.getElementById("clear-roster"),
  importStatus: document.getElementById("import-status"),
  rosterBody: document.getElementById("roster-body"),
  rosterEmpty: document.getElementById("roster-empty"),
  filter: document.getElementById("class-filter"),
  filterField: document.getElementById("class-filter-field"),
  drawMode: document.getElementById("draw-mode"),
  eventTitle: document.getElementById("event-title"),
  draw: document.getElementById("draw-btn"),
  drawLockReason: document.getElementById("draw-lock-reason"),
  protocolSection: document.getElementById("protocol-section"),
  protocolMeta: document.getElementById("protocol-meta"),
  protocolGroups: document.getElementById("protocol-groups"),
  copy: document.getElementById("copy-btn"),
  print: document.getElementById("print-btn"),
  stage: document.getElementById("draw-stage"),
  drawClass: document.getElementById("draw-class"),
  drawProgress: document.getElementById("draw-progress"),
  drawNumber: document.getElementById("draw-number"),
  drawDog: document.getElementById("draw-dog"),
  drawMeta: document.getElementById("draw-meta"),
  drawLiveList: document.getElementById("draw-live-list"),
};

function uid() {
  return crypto.randomUUID();
}

function looksLikeDateValue(value) {
  return /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(String(value || "").trim());
}

function normalizeClassName(value) {
  const v = String(value || "").trim();
  if (!v || looksLikeDateValue(v)) return "";
  return v;
}

function loadRoster() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = parsed.map((p) => ({
      ...p,
      className: normalizeClassName(p?.className),
    }));
    if (items.some((p, i) => p.className !== String(parsed[i]?.className || "").trim())) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch {
        /* ignore quota */
      }
    }
    return items;
  } catch {
    return [];
  }
}

function saveRoster() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const tabs = (first.match(/\t/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  if (tabs >= 2) return "\t";
  if (semis >= 2) return ";";
  if (commas >= 2) return ",";
  if (tabs >= 1) return "\t";
  if (semis >= 1) return ";";
  return ",";
}

/** Простой разбор CSV с кавычками */
function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  return value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "")
    .trim();
}

function isYesValue(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!v) return false;
  // «да», «да, почта», «ДА » и т.п.
  if (v === "да" || v.startsWith("да,") || v.startsWith("да ") || v.startsWith("да/")) {
    return true;
  }
  return v === "yes" || v === "true" || v === "1" || v === "+";
}

function normalizeCell(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function isReserveValue(value) {
  return normalizeCell(value).includes("резерв");
}

function isRejectValue(value) {
  return normalizeCell(value).includes("отказ");
}

/**
 * Индексы колонок: ФИО / порода / кличка / класс / отправлено / подтверждение / сумма
 * Если заголовка нет — берём первые 4 колонки по порядку.
 */
function mapColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const find = (...aliases) =>
    normalized.findIndex((h) => aliases.some((a) => h.includes(a) || h === a));

  const fio = find("фио", "фамилияимяотчество", "фиопроводника", "владелец", "проводник", "участник");
  const breed = find("породысобаки", "породы", "порода");
  const dog = find("кличкасобаки", "кличка", "имясобаки");
  const className = find("классвыступления", "класвыступления", "класс", "ринг");
  const messageSent = find("отправленосообщение", "отправлено");
  // «подтверждение» — статус (резерв и т.п.), не путать с длинным «Подтверждаю, что собака…»
  const confirmation = normalized.findIndex((h) => h === "подтверждение" || h.startsWith("подтверждение"));
  const paymentSum = find("суммаоплаты", "сумма");

  if (fio >= 0 || breed >= 0 || dog >= 0 || className >= 0) {
    return {
      fio: fio >= 0 ? fio : 0,
      breed: breed >= 0 ? breed : 1,
      dog: dog >= 0 ? dog : 2,
      // без колонки класса не подставляем 3-ю колонку (там может быть дата рождения)
      className,
      messageSent,
      confirmation,
      paymentSum,
      hasHeader: true,
    };
  }

  return {
    fio: 0,
    breed: 1,
    dog: 2,
    className: 3,
    messageSent: -1,
    confirmation: -1,
    paymentSum: -1,
    hasHeader: false,
  };
}

function looksLikeHeader(cells) {
  const joined = cells.map(normalizeHeader).join("|");
  return (
    joined.includes("фио") ||
    joined.includes("порода") ||
    joined.includes("кличка") ||
    joined.includes("класс")
  );
}

/**
 * @param {string} text
 * @returns {{
 *   items: Participant[],
 *   totalRows: number,
 *   skippedNoMessage: number,
 *   skippedReserve: number,
 *   skippedReject: number,
 *   filteredByMessage: boolean
 * }}
 */
function parseTableText(text) {
  const empty = {
    items: [],
    totalRows: 0,
    skippedNoMessage: 0,
    skippedReserve: 0,
    skippedReject: 0,
    filteredByMessage: false,
  };

  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return empty;

  const delimiter = detectDelimiter(cleaned);
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return empty;

  const firstCells = splitCsvLine(lines[0], delimiter);
  const columns = looksLikeHeader(firstCells)
    ? mapColumns(firstCells)
    : {
        fio: 0,
        breed: 1,
        dog: 2,
        className: 3,
        messageSent: -1,
        confirmation: -1,
        paymentSum: -1,
        hasHeader: false,
      };

  const start = columns.hasHeader ? 1 : 0;
  const filteredByMessage = columns.messageSent >= 0;
  /** @type {Participant[]} */
  const items = [];
  let totalRows = 0;
  let skippedNoMessage = 0;
  let skippedReserve = 0;
  let skippedReject = 0;

  for (let i = start; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delimiter);
    if (!cells.some((c) => c)) continue;

    const fio = (cells[columns.fio] || "").trim();
    const breed = (cells[columns.breed] || "").trim();
    const dog = (cells[columns.dog] || "").trim();
    const className =
      columns.className >= 0 ? normalizeClassName(cells[columns.className] || "") : "";
    const confirmation = columns.confirmation >= 0 ? cells[columns.confirmation] || "" : "";
    const paymentSum = columns.paymentSum >= 0 ? cells[columns.paymentSum] || "" : "";

    // Пропускаем служебные/пустые строки из выгрузки форм
    if (!fio && !dog) continue;
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(fio)) continue;

    totalRows += 1;

    if (filteredByMessage && !isYesValue(cells[columns.messageSent])) {
      skippedNoMessage += 1;
      continue;
    }

    if (isReserveValue(confirmation) || isReserveValue(paymentSum)) {
      skippedReserve += 1;
      continue;
    }

    if (isRejectValue(confirmation) || isRejectValue(paymentSum)) {
      skippedReject += 1;
      continue;
    }

    items.push({
      id: uid(),
      fio,
      breed,
      dog: dog || "—",
      className,
    });
  }

  return {
    items,
    totalRows,
    skippedNoMessage,
    skippedReserve,
    skippedReject,
    filteredByMessage,
  };
}

function setImportStatus(message) {
  els.importStatus.textContent = message;
}

function replaceRoster(items) {
  roster = items;
  lastDrawGroups = [];
  saveRoster();
  els.protocolSection.hidden = true;
  render();
}

function removeParticipant(id) {
  roster = roster.filter((p) => p.id !== id);
  saveRoster();
  render();
}

function uniqueClasses() {
  return [...new Set(roster.map((p) => p.className).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function rosterHasClasses() {
  return uniqueClasses().length > 0;
}

function isFlatDraw() {
  return !els.drawMode || els.drawMode.value !== "by-class" || !rosterHasClasses();
}

function groupsHaveClasses(groups) {
  return groups.some((g) => g.className);
}

function filteredRoster() {
  if (isFlatDraw()) return [...roster];
  const value = els.filter.value;
  if (!value) return [...roster];
  return roster.filter((p) => p.className === value);
}

/**
 * Участники, разложенные по классам (без перемешивания).
 * @param {Participant[]} pool
 * @returns {Map<string, Participant[]>}
 */
function groupByClass(pool) {
  /** @type {Map<string, Participant[]>} */
  const map = new Map();
  const anyClass = pool.some((p) => p.className);
  pool.forEach((p) => {
    const key = anyClass ? p.className || "без класса" : "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  });
  return map;
}

/**
 * Группировка по классу. Внутри каждого класса — свой перемешанный список.
 * @param {Participant[]} pool
 * @returns {DrawGroup[]}
 */
function buildShuffledClassGroups(pool) {
  const map = groupByClass(pool);
  return [...map.keys()]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((className) => ({
      className,
      ordered: shuffle(map.get(className) || []),
    }))
    .filter((group) => group.ordered.length > 0);
}

function buildDrawGroups(pool) {
  if (isFlatDraw()) {
    return [{ className: "", ordered: shuffle([...pool]) }];
  }
  return buildShuffledClassGroups(pool);
}

function totalDrawnCount() {
  return lastDrawGroups.reduce((sum, g) => sum + g.ordered.length, 0);
}

/** Fisher–Yates */
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatParticipantLine(p) {
  return [p.fio, p.breed, p.dog, p.className].filter(Boolean).join(" · ");
}

function renderRoster() {
  els.rosterBody.innerHTML = "";
  roster.forEach((p, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-num"></td>
      <td></td>
      <td></td>
      <td class="dog-cell"></td>
      <td class="col-class"></td>
      <td><button type="button" class="icon-btn" data-id="${p.id}">Удалить</button></td>
    `;
    const cells = tr.querySelectorAll("td");
    cells[0].textContent = String(index + 1);
    cells[1].textContent = p.fio || "—";
    cells[2].textContent = p.breed || "—";
    cells[3].textContent = p.dog || "—";
    cells[4].textContent = p.className || "—";
    els.rosterBody.appendChild(tr);
  });
  if (roster.length > 0) {
    els.rosterEmpty.hidden = true;
  } else {
    els.rosterEmpty.hidden = false;
    els.rosterEmpty.textContent = "Список пуст — вставьте ссылку на Google Таблицу.";
  }
}

function renderFilter() {
  const current = els.filter.value;
  const hasClasses = rosterHasClasses();
  const table = document.getElementById("roster-table");
  if (table) table.classList.toggle("no-classes", !hasClasses);

  if (els.drawMode) {
    const saved = localStorage.getItem(DRAW_MODE_KEY);
    if (saved === "flat" || saved === "by-class") {
      els.drawMode.value = saved;
    } else if (!els.drawMode.dataset.touched) {
      els.drawMode.value = hasClasses ? "by-class" : "flat";
    }
  }

  if (els.filterField) {
    els.filterField.hidden = isFlatDraw() || !hasClasses;
  }

  const classes = uniqueClasses();
  els.filter.innerHTML = `<option value="">Все классы</option>`;
  classes.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    els.filter.appendChild(opt);
  });
  if (classes.includes(current)) els.filter.value = current;
}

function protocolMetaText() {
  const title = els.eventTitle.value.trim();
  const klass = els.filter.value;
  const when = new Date().toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = [];
  if (title) parts.push(title);
  if (groupsHaveClasses(lastDrawGroups)) {
    if (klass) parts.push(`класс: ${klass}`);
    else parts.push(`классов: ${lastDrawGroups.length}`);
  } else {
    parts.push("одним списком");
  }
  parts.push(`участников: ${totalDrawnCount()}`);
  parts.push(when);
  return parts.join(" · ");
}

function renderProtocol() {
  if (!lastDrawGroups.length) {
    els.protocolSection.hidden = true;
    return;
  }

  els.protocolSection.hidden = false;
  els.protocolMeta.textContent = protocolMetaText();
  els.protocolGroups.innerHTML = "";

  lastDrawGroups.forEach((group, groupIndex) => {
    const block = document.createElement("section");
    block.className = "protocol-class";
    block.innerHTML = `
      <h3 class="protocol-class__title"></h3>
      <p class="protocol-class__meta"></p>
      <div class="table-wrap">
        <table class="data-table protocol-table">
          <thead>
            <tr>
              <th>Стартовый №</th>
              <th>ФИО</th>
              <th>Порода</th>
              <th>Кличка</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;
    const titleEl = block.querySelector(".protocol-class__title");
    if (group.className) {
      titleEl.textContent = group.className;
    } else {
      titleEl.hidden = true;
    }
    block.querySelector(".protocol-class__meta").textContent =
      `участников: ${group.ordered.length}`;

    const tbody = block.querySelector("tbody");
    group.ordered.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.style.animationDelay = `${groupIndex * 80 + i * 35}ms`;
      tr.innerHTML = `
        <td class="col-num"></td>
        <td></td>
        <td></td>
        <td class="dog-cell"></td>
      `;
      const cells = tr.querySelectorAll("td");
      cells[0].textContent = String(i + 1);
      cells[1].textContent = p.fio || "—";
      cells[2].textContent = p.breed || "—";
      cells[3].textContent = p.dog || "—";
      tbody.appendChild(tr);
    });

    els.protocolGroups.appendChild(block);
  });
}

function canDrawPool(pool) {
  if (pool.length < 2) return false;
  if (isFlatDraw()) return true;
  const map = groupByClass(pool);
  if ([...map.values()].some((list) => list.length >= 2)) return true;
  return pool.every((p) => !p.className);
}

function updateDrawButton() {
  const pool = filteredRoster();
  const ok = !drawing && canDrawPool(pool);
  els.draw.disabled = !ok;
  if (!els.drawLockReason) return;
  if (ok || drawing) {
    els.drawLockReason.hidden = true;
    els.drawLockReason.textContent = "";
    return;
  }
  els.drawLockReason.hidden = false;
  if (!pool.length) {
    els.drawLockReason.textContent = "Сначала загрузите список участников.";
  } else if (pool.length < 2) {
    els.drawLockReason.textContent = "Нужно минимум два участника.";
  } else {
    els.drawLockReason.textContent = "В выбранном классе меньше двух участников.";
  }
}

function render() {
  renderRoster();
  renderFilter();
  updateDrawButton();
  if (lastDrawGroups.length) renderProtocol();
}

function openStage() {
  els.stage.hidden = false;
  document.body.classList.add("is-drawing");
  els.drawLiveList.innerHTML = "";
  els.drawClass.textContent = "";
  els.drawNumber.textContent = "—";
  els.drawDog.textContent = "…";
  els.drawDog.className = "draw-stage__dog";
  els.drawMeta.textContent = "";
  els.drawProgress.textContent = "Перемешиваем участников…";
}

function closeStage() {
  els.stage.hidden = true;
  document.body.classList.remove("is-drawing");
}

function appendLiveResult(order, participant) {
  const li = document.createElement("li");
  li.innerHTML = `<strong></strong><span></span>`;
  li.querySelector("strong").textContent = `${order}.`;
  li.querySelector("span").textContent = `${participant.dog} — ${participant.fio || "без ФИО"}`;
  els.drawLiveList.prepend(li);
}

/**
 * @param {DrawGroup[]} groups
 */
async function runLiveDraw(groups) {
  openStage();
  await sleep(600);
  const namedAny = groupsHaveClasses(groups);

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g];
    const named = Boolean(group.className);
    els.drawClass.textContent = named ? `Класс: ${group.className}` : "";
    els.drawLiveList.innerHTML = "";
    els.drawProgress.textContent = named
      ? `Класс ${g + 1} из ${groups.length} · ${group.ordered.length} уч.`
      : `${group.ordered.length} участников`;
    await sleep(500);

    const remainingPreview = [...group.ordered];

    for (let i = 0; i < group.ordered.length; i += 1) {
      const participant = group.ordered[i];
      const order = i + 1;
      els.drawProgress.textContent = named
        ? `${group.className}: номер ${order} из ${group.ordered.length}`
        : `Номер ${order} из ${group.ordered.length}`;
      els.drawNumber.textContent = String(order);
      els.drawDog.className = "draw-stage__dog is-spinning";
      els.drawMeta.textContent = "Случайный выбор…";

      const base = group.ordered.length > 15 ? 420 : 650;
      const spinMs = Math.min(1200, base + i * 20);
      const step = group.ordered.length > 15 ? 50 : 65;
      const end = performance.now() + spinMs;

      while (performance.now() < end) {
        const preview =
          remainingPreview[Math.floor(Math.random() * remainingPreview.length)] || participant;
        els.drawDog.textContent = preview.dog;
        els.drawMeta.textContent = [preview.fio, preview.breed].filter(Boolean).join(" · ");
        await sleep(step);
      }

      els.drawDog.textContent = participant.dog;
      els.drawDog.className = "draw-stage__dog is-locked";
      els.drawMeta.textContent = formatParticipantLine(participant);
      appendLiveResult(order, participant);

      const idx = remainingPreview.findIndex((p) => p.id === participant.id);
      if (idx >= 0) remainingPreview.splice(idx, 1);

      await sleep(420);
    }

    if (g < groups.length - 1) {
      els.drawProgress.textContent = `Класс «${group.className}» готов · следующий…`;
      await sleep(700);
    }
  }

  els.drawClass.textContent = "";
  els.drawProgress.textContent = namedAny
    ? "Жеребьёвка по всем классам завершена"
    : "Жеребьёвка завершена";
  els.drawNumber.textContent = "✓";
  els.drawDog.textContent = namedAny ? "Протоколы готовы" : "Протокол готов";
  els.drawDog.className = "draw-stage__dog is-locked";
  const total = groups.reduce((s, x) => s + x.ordered.length, 0);
  els.drawMeta.textContent = namedAny
    ? `Классов: ${groups.length} · участников: ${total}`
    : `Участников: ${total}`;
  await sleep(1200);
  closeStage();
}

/**
 * Достаёт id таблицы и gid листа из обычной ссылки, ссылки «создать копию» или голого id.
 * @param {string} input
 * @returns {{ id: string, gid: string | null } | null}
 */
function parseGoogleSheetRef(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const copySource = text.match(/[?&#]copySourceId=([a-zA-Z0-9-_]+)/i);
  if (copySource) {
    return { id: copySource[1], gid: null };
  }

  const fromPath = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (fromPath) {
    const gidMatch = text.match(/[?#&]gid=([0-9]+)/i);
    return { id: fromPath[1], gid: gidMatch ? gidMatch[1] : null };
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) {
    return { id: text, gid: null };
  }

  return null;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** @param {{ cols: Array<{ label?: string, id?: string }>, rows: Array<{ c?: Array<{ v?: unknown, f?: string } | null> }> }} table */
function gvizTableToCsv(table) {
  const headers = (table.cols || []).map((col) => col.label || col.id || "");
  const lines = [headers.map(escapeCsvCell).join(",")];

  for (const row of table.rows || []) {
    const cells = headers.map((_, index) => {
      const cell = row.c?.[index];
      if (!cell) return "";
      if (cell.f != null && cell.f !== "") return String(cell.f);
      if (cell.v == null) return "";
      return String(cell.v);
    });
    lines.push(cells.map(escapeCsvCell).join(","));
  }

  return lines.join("\n");
}

/**
 * Полный CSV (включая строки, скрытые фильтром листа).
 * @param {string} spreadsheetId
 * @param {string | null} gid
 */
const SHEET_ACCESS_MESSAGE =
  "Нет доступа к таблице. В Google Таблице: Настройки доступа → «Все, у кого есть ссылка» → Читатель.";

function describeSheetLoadError(rawMessage) {
  const raw = String(rawMessage || "");
  const looksLikeAccess =
    /failed to fetch|нет доступа|закрыл чтение|не удалось скачать|не удалось получить таблицу|не удалось обратиться/i.test(
      raw,
    );
  if (looksLikeAccess) {
    if (location.protocol === "file:") {
      return `${SHEET_ACCESS_MESSAGE} Если открываете файл напрямую — запустите через открыть.command.`;
    }
    return SHEET_ACCESS_MESSAGE;
  }
  return raw || "Неизвестная ошибка загрузки.";
}

async function fetchSheetCsvExport(spreadsheetId, gid) {
  let url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv`;
  if (gid) url += `&gid=${encodeURIComponent(gid)}`;

  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch {
    // CORS / редирект на вход — дальше пробуем JSONP
    throw new Error("Не удалось скачать выгрузку CSV.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(SHEET_ACCESS_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(`Google вернул статус ${response.status}. Проверьте ссылку и доступ.`);
  }
  const text = await response.text();
  if (!text.trim() || text.includes("<!DOCTYPE html") || text.includes("<html")) {
    throw new Error(
      "Не удалось скачать таблицу. Откройте доступ: «Все, у кого есть ссылка» → Читатель.",
    );
  }
  return text;
}

/**
 * Запасной путь: gviz + JSONP (может не видеть строки, скрытые фильтром в таблице).
 * @param {string} spreadsheetId
 * @param {string | null} gid
 */
function fetchSheetTableJsonp(spreadsheetId, gid) {
  return new Promise((resolve, reject) => {
    // Имя колбэка только из безопасных символов — пойдёт в URL как есть
    const callbackName = `__dogDrawSheetCb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
      script.remove();
    };

    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const timer = window.setTimeout(() => {
      fail("Не удалось получить таблицу вовремя. Проверьте доступ по ссылке.");
    }, 20000);

    window[callbackName] = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!payload || payload.status !== "ok" || !payload.table) {
        const reason = payload?.errors?.[0]?.detailed_message || payload?.status || "ошибка";
        reject(new Error(`Google Таблица не отдала данные (${reason}). Откройте доступ по ссылке.`));
        return;
      }
      resolve(payload.table);
    };

    // Важно: двоеточие в responseHandler:имя нельзя кодировать в %3A — Google тогда не вызывает колбэк
    let src = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=responseHandler:${callbackName}`;
    if (gid) src += `&gid=${encodeURIComponent(gid)}`;

    script.src = src;
    script.async = true;
    script.onerror = () => {
      fail("Не удалось обратиться к Google Таблице. Проверьте ссылку и доступ.");
    };
    document.head.appendChild(script);
  });
}

async function loadFromGoogleSheetUrl(rawUrl) {
  const ref = parseGoogleSheetRef(rawUrl);
  if (!ref) {
    setImportStatus("Не похоже на ссылку Google Таблицы. Вставьте полный адрес.");
    return;
  }

  localStorage.setItem(SHEET_URL_KEY, rawUrl.trim());
  els.loadSheet.disabled = true;
  els.rosterEmpty.hidden = false;
  els.rosterEmpty.textContent = "Загружаю участников…";
  setImportStatus("Загружаю таблицу…");

  try {
    let csv;
    let via = "export";
    try {
      csv = await fetchSheetCsvExport(ref.id, ref.gid);
    } catch (exportError) {
      const exportMessage =
        exportError instanceof Error ? exportError.message : "Ошибка выгрузки CSV";
      // Если доступ закрыт — не маскируем запасным путём
      if (/нет доступа|закрыл чтение|все, у кого есть ссылка/i.test(exportMessage)) {
        throw exportError;
      }
      // file:// или блокировка fetch — пробуем JSONP
      via = "jsonp";
      try {
        const table = await fetchSheetTableJsonp(ref.id, ref.gid);
        csv = gvizTableToCsv(table);
      } catch {
        throw new Error(describeSheetLoadError(exportMessage));
      }
    }
    await handleImportText(
      csv,
      via === "export" ? "из Google Таблицы" : "из Google Таблицы (запасной путь)",
    );
    if (!roster.length) {
      els.rosterEmpty.hidden = false;
      els.rosterEmpty.textContent = "После фильтров никого не осталось. Проверьте колонки в таблице.";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка загрузки.";
    setImportStatus(message);
    els.rosterEmpty.hidden = false;
    els.rosterEmpty.textContent = "Не удалось загрузить список. " + message;
  } finally {
    els.loadSheet.disabled = false;
  }
}

async function handleImportText(text, sourceLabel) {
  const {
    items,
    totalRows,
    skippedNoMessage,
    skippedReserve,
    skippedReject,
    filteredByMessage,
  } = parseTableText(text);

  if (!items.length) {
    if (totalRows > 0) {
      setImportStatus(
        `Никого не загрузили из ${totalRows} строк` +
          (filteredByMessage ? " (нет «да» / резерв / отказ)" : " (резерв / отказ)") +
          ".",
      );
      return;
    }
    setImportStatus("Не удалось прочитать таблицу. Проверьте колонки.");
    return;
  }

  replaceRoster(items);
  const byClass = items.reduce((acc, p) => {
    const key = p.className || "";
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));
  const classSummary = Object.entries(byClass)
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");

  const skippedParts = [];
  if (skippedNoMessage) skippedParts.push(`без «да»: ${skippedNoMessage}`);
  if (skippedReserve) skippedParts.push(`резерв: ${skippedReserve}`);
  if (skippedReject) skippedParts.push(`отказ: ${skippedReject}`);

  setImportStatus(
    `Загружено: ${items.length}` +
      (skippedParts.length ? ` · пропущено ${skippedParts.join(", ")}` : "") +
      (classSummary ? ` · ${classSummary}` : "") +
      ` (${sourceLabel})`,
  );
}

const savedSheetUrl = localStorage.getItem(SHEET_URL_KEY);
if (savedSheetUrl) els.sheetUrl.value = savedSheetUrl;

els.loadSheet.addEventListener("click", () => {
  loadFromGoogleSheetUrl(els.sheetUrl.value);
});

els.sheetUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    loadFromGoogleSheetUrl(els.sheetUrl.value);
  }
});

els.loadTable.addEventListener("click", () => {
  handleImportText(els.tableInput.value, "из поля ввода");
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  const text = await file.text();
  await handleImportText(text, file.name);
  els.file.value = "";
});

els.paste.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    els.tableInput.value = text;
    await handleImportText(text, "из буфера");
  } catch {
    setImportStatus("Нет доступа к буферу — вставьте таблицу вручную (Ctrl/⌘+V).");
    els.tableInput.focus();
  }
});

els.clear.addEventListener("click", () => {
  if (!roster.length) return;
  if (!confirm("Очистить весь список участников?")) return;
  replaceRoster([]);
  setImportStatus("Список очищен");
});

els.rosterBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-id]");
  if (!btn || drawing) return;
  removeParticipant(btn.dataset.id);
});

els.filter.addEventListener("change", updateDrawButton);

if (els.drawMode) {
  els.drawMode.addEventListener("change", () => {
    els.drawMode.dataset.touched = "1";
    localStorage.setItem(DRAW_MODE_KEY, els.drawMode.value);
    renderFilter();
    updateDrawButton();
  });
}

els.draw.addEventListener("click", async () => {
  const pool = filteredRoster();
  if (drawing || !canDrawPool(pool)) return;

  drawing = true;
  updateDrawButton();
  els.protocolSection.hidden = true;

  try {
    const groups = buildDrawGroups(pool);
    await runLiveDraw(groups);
    lastDrawGroups = groups;
    renderProtocol();
    els.protocolSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    drawing = false;
    closeStage();
    updateDrawButton();
  }
});

els.copy.addEventListener("click", async () => {
  if (!lastDrawGroups.length) return;
  const title = els.eventTitle.value.trim();
  const meta = protocolMetaText();
  const chunks = [`Протокол жеребьёвки${title ? `: ${title}` : ""}`, meta, ""];

  lastDrawGroups.forEach((group) => {
    if (group.className) chunks.push(`Класс: ${group.className}`);
    chunks.push(["Стартовый №", "ФИО", "Порода", "Кличка"].join("\t"));
    group.ordered.forEach((p, i) => {
      chunks.push([i + 1, p.fio, p.breed, p.dog].join("\t"));
    });
    chunks.push("");
  });

  try {
    await navigator.clipboard.writeText(chunks.join("\n").trim() + "\n");
    els.copy.textContent = "Скопировано";
    setTimeout(() => {
      els.copy.textContent = "Копировать";
    }, 1600);
  } catch {
    alert("Не удалось скопировать протокол.");
  }
});

els.print.addEventListener("click", () => {
  window.print();
});

render();
