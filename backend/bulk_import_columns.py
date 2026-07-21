"""Column detection and pre-population helpers for bulk actual imports.

Supports enriched statement exports that already include Entity, Month,
Category, and Flow match (in addition to Date / Posting text / Amount / Value).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Sequence


# Canonical category labels must match server.Category values (SSOT enforced in tests).
DEFAULT_CATEGORY_VALUES = (
    "Revenue",
    "Salary",
    "Tax",
    "Debt",
    "Expense",
    "Transfer",
    "COGS",
    "Other",
)


def _norm_header(raw: Any) -> str:
    text = str(raw or "").strip().replace("\ufeff", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).lower()


def detect_import_columns(columns: List[str]) -> Dict[str, str]:
    """Map statement headers to canonical import fields.

    Returns keys among:
      date, description, amount, debit, credit,
      value_date, entity, month, category, flow_match
    """
    cols: Dict[str, str] = {}
    for c in columns:
        if c is None:
            continue
        raw = str(c).strip()
        if not raw:
            continue
        cols[_norm_header(raw)] = raw

    date_exact = [
        "date",
        "transaction date",
        "booking date",
        "buchungsdatum",
        "buchungstag",
        "transaktionsdatum",
        "posting date",
        "trade date",
        "datum",
    ]
    value_date_exact = [
        "value date",
        "value",
        "valuta",
        "valutadatum",
        "wertstellung",
    ]
    desc_exact = [
        "description",
        "label",
        "details",
        "memo",
        "narrative",
        "name",
        "text",
        "beschreibung",
        "buchungstext",
        "verwendungszweck",
        "zweck",
        "payee",
        "empfänger",
        "empfaenger",
        "begünstigter",
        "beguenstigter",
        "merchant",
        "note",
        "bemerkung",
        "posting text",
        "buchungstext en",
        "booking text",
        "posting",
    ]
    # Bare "value" is treated as value_date when an Amount column also exists
    # (enriched bank exports). Keep it as an amount alias only as a fallback.
    amount_exact = [
        "amount",
        "chf",
        "betrag",
        "amount chf",
        "transaction amount",
        "booked amount",
    ]
    amount_fallback_exact = ["value"]
    debit_exact = ["debit", "soll", "belastung", "lastschrift", "abgang", "withdrawal"]
    credit_exact = ["credit", "haben", "gutschrift", "guthaben", "eingang", "deposit"]
    entity_exact = ["entity", "company", "organisation", "organization", "firma", "gesellschaft"]
    month_exact = ["month", "period", "periode", "monat", "booking month"]
    # Keep aliases explicit — avoid broad headers like "type" / "line" / "match" / "flow".
    category_exact = ["category", "kategorie"]
    flow_match_exact = [
        "flow match",
        "cash flow",
        "matched flow",
        "cash line",
        "flow label",
    ]

    def pick_exact(keys: List[str], used: Optional[set] = None) -> Optional[str]:
        used = used or set()
        for k in keys:
            if k in cols and cols[k] not in used:
                return cols[k]
        return None

    def pick_contains(subs: tuple, exclude: tuple = (), used: Optional[set] = None) -> Optional[str]:
        used = used or set()
        for col_lower, orig in cols.items():
            if orig in used:
                continue
            if any(ex in col_lower for ex in exclude):
                continue
            for sub in subs:
                if sub in col_lower:
                    return orig
        return None

    detected: Dict[str, str] = {}
    used: set = set()

    date_col = pick_exact(date_exact) or pick_contains(
        (
            "buchungsdatum",
            "buchungstag",
            "transaktionsdatum",
            "booking date",
            "trade date",
            "posting date",
        ),
        ("betrag", "amount", "belastung", "gutschrift", "text", "beschreibung", "posting text", "value"),
    )
    if date_col:
        detected["date"] = date_col
        used.add(date_col)

    # Prefer dedicated value-date headers; also accept bare "Value" once Amount exists.
    value_date_col = pick_exact(value_date_exact, used) or pick_contains(
        ("value date", "valutadatum", "valuta", "wertstellung"),
        ("betrag", "amount", "text", "beschreibung"),
        used,
    )
    amount_col = pick_exact(amount_exact, used) or pick_contains(
        ("betrag", "amount", "chf"),
        ("datum", "date", "buchung", "value date", "valuta"),
        used,
    )
    if not amount_col:
        # Only use bare "Value" as amount when nothing else qualifies.
        amount_col = pick_exact(amount_fallback_exact, used)

    if amount_col:
        detected["amount"] = amount_col
        used.add(amount_col)

    if value_date_col and value_date_col not in used:
        detected["value_date"] = value_date_col
        used.add(value_date_col)
    elif not date_col:
        # No booking date: allow value date to drive transaction_date.
        vd = pick_exact(["value date", "valuta", "valutadatum", "value"], used)
        if vd:
            detected["date"] = vd
            used.add(vd)

    desc_col = pick_exact(desc_exact, used) or pick_contains(
        ("beschreibung", "text", "zweck", "verwendung", "detail", "memo", "narrative", "payee", "merchant", "posting"),
        (),
        used,
    )
    if desc_col:
        detected["description"] = desc_col
        used.add(desc_col)

    if "amount" not in detected:
        debit_col = pick_exact(debit_exact, used) or pick_contains(
            ("belastung", "debit", "soll", "abgang", "lastschrift"), (), used
        )
        credit_col = pick_exact(credit_exact, used) or pick_contains(
            ("gutschrift", "guthaben", "credit", "haben", "eingang"), (), used
        )
        if debit_col and credit_col:
            detected["debit"] = debit_col
            detected["credit"] = credit_col
            used.add(debit_col)
            used.add(credit_col)

    entity_col = pick_exact(entity_exact, used) or pick_contains(("entity", "company", "firma", "gesellschaft"), (), used)
    if entity_col:
        detected["entity"] = entity_col
        used.add(entity_col)

    month_col = pick_exact(month_exact, used) or pick_contains(("month", "period", "periode", "monat"), ("amount",), used)
    if month_col:
        detected["month"] = month_col
        used.add(month_col)

    category_col = pick_exact(category_exact, used) or pick_contains(("category", "kategorie"), (), used)
    if category_col:
        detected["category"] = category_col
        used.add(category_col)

    flow_col = pick_exact(flow_match_exact, used) or pick_contains(
        ("flow match", "matched flow", "cash flow", "flow label"),
        ("category",),
        used,
    )
    if flow_col:
        detected["flow_match"] = flow_col
        used.add(flow_col)

    # If the file only has a value-date column (no booking Date), use it as date.
    if "date" not in detected and detected.get("value_date"):
        detected["date"] = detected["value_date"]

    return {k: v for k, v in detected.items() if v}


def normalize_month_cell(raw: Any) -> Optional[str]:
    """Normalize a Month cell to YYYY-MM when possible."""
    if raw is None or raw == "":
        return None
    if hasattr(raw, "strftime"):
        try:
            return raw.strftime("%Y-%m")
        except Exception:
            pass
    text = str(raw).strip()
    if not text:
        return None
    # Excel serials are handled upstream via date parsing; accept YYYY-MM / YYYY/MM / YYYY.MM
    m = re.match(r"^(\d{4})[-/.](\d{1,2})$", text)
    if m:
        year, mon = int(m.group(1)), int(m.group(2))
        if 1 <= mon <= 12 and 1900 <= year <= 3000:
            return f"{year:04d}-{mon:02d}"
    m2 = re.match(r"^(\d{4})(\d{2})$", text)
    if m2:
        year, mon = int(m2.group(1)), int(m2.group(2))
        if 1 <= mon <= 12 and 1900 <= year <= 3000:
            return f"{year:04d}-{mon:02d}"
    return None


def parse_category_label(
    raw: Any,
    *,
    allowed: Optional[Sequence[str]] = None,
) -> Optional[str]:
    """Return canonical Category value or None if unrecognized.

    `allowed` should be the live Category enum values (SSOT). Defaults to
    DEFAULT_CATEGORY_VALUES which must stay in sync with server.Category.
    """
    if raw is None or raw == "":
        return None
    text = str(raw).strip()
    if not text:
        return None
    canon = {str(v): str(v) for v in (allowed or DEFAULT_CATEGORY_VALUES)}
    by_lower = {k.lower(): v for k, v in canon.items()}
    key = text.lower()
    if key in by_lower:
        return by_lower[key]
    first = re.split(r"[\s\-–|/]+", key)[0]
    if first in by_lower:
        return by_lower[first]
    return None


def resolve_entity_id_from_name(
    raw_name: Any,
    entities: Sequence[dict],
    *,
    default_entity_id: Optional[str] = None,
) -> Optional[str]:
    """Resolve an Entity cell (name or id) to an entity id.

    Empty cell → `default_entity_id`.
    Non-empty unresolved cell → `None` (caller must warn; do not silently
    substitute the default — that caused wrong entity/flow scoping).
    Matching is exact id or case-insensitive exact name only.
    """
    if raw_name is None or str(raw_name).strip() == "":
        return default_entity_id
    text = str(raw_name).strip()
    for ent in entities:
        if ent.get("id") == text:
            return ent["id"]
    lower = text.lower()
    exact = [e for e in entities if (e.get("name") or "").strip().lower() == lower]
    if exact:
        return exact[0]["id"]
    return None


def _flow_belongs_to_entity(flow: dict, entity_id: Optional[str]) -> bool:
    """True if flow is in scope. Legacy rows missing entity_id stay eligible."""
    if not entity_id:
        return True
    flow_entity = flow.get("entity_id")
    if flow_entity in (None, ""):
        return True
    return flow_entity == entity_id


def _flow_category_str(flow: dict) -> str:
    cat = flow.get("category", "Expense")
    if hasattr(cat, "value"):
        return str(cat.value)
    return str(cat or "Expense")


def flow_display_label(flow: dict) -> str:
    """UI-style label: '{label} - {category}'."""
    label = (flow.get("label") or "").strip()
    cat = _flow_category_str(flow)
    if label and cat:
        return f"{label} - {cat}"
    return label or cat


def _fold_match_text(raw: Any) -> str:
    """Casefold + strip accents/punctuation noise for resilient label compare."""
    text = str(raw or "").strip().lower()
    if not text:
        return ""
    # NFKD then drop combining marks so Trésorerie ~= Tresorerie
    decomposed = unicodedata.normalize("NFKD", text)
    folded = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    folded = folded.replace("\xa0", " ")
    folded = re.sub(r"\s+", " ", folded).strip()
    return folded


def _normalize_match_label(raw: str) -> str:
    """Strip trailing ' - Category' suffix when present (UI export style)."""
    text = (raw or "").strip()
    if not text:
        return ""
    for sep in (" - ", " – ", " — ", "-", "–", "—"):
        if sep in text:
            left, right = text.rsplit(sep, 1)
            if right.strip().lower() in {
                "revenue", "expense", "cogs", "opex", "debt", "tax", "salary", "transfer", "other",
            }:
                return left.strip()
    return text


def _label_variants(text: str) -> set:
    """Comparable forms of a Flow match cell or flow label."""
    raw = (text or "").strip()
    if not raw:
        return set()
    variants = {_fold_match_text(raw), _fold_match_text(_normalize_match_label(raw))}
    return {v for v in variants if v}


def _flow_label_variants(flow: dict) -> set:
    variants = set()
    variants |= _label_variants(flow.get("label") or "")
    variants |= _label_variants(flow_display_label(flow))
    return variants


def _find_flows_for_match_text(
    flows: Sequence[dict],
    text: str,
    entity_id: Optional[str],
) -> List[dict]:
    """Return all candidate flows that match the file Flow match cell."""
    wanted = _label_variants(text)
    if not wanted:
        return []
    candidates = [f for f in flows if _flow_belongs_to_entity(f, entity_id)]
    hits: List[dict] = []
    seen = set()

    def add(f: dict) -> None:
        fid = f.get("id")
        if fid in seen:
            return
        seen.add(fid)
        hits.append(f)

    for f in candidates:
        if wanted.intersection(_flow_label_variants(f)):
            add(f)

    # Contains / prefix against folded labels (unique enough for file-driven match).
    if not hits:
        for f in candidates:
            labs = _flow_label_variants(f)
            for w in wanted:
                if any(w == lab or w in lab or lab in w for lab in labs if lab):
                    add(f)
                    break

    return hits


def _prefer_flow_hits(
    hits: List[dict],
    *,
    entity_id: Optional[str] = None,
    entity_name: Optional[str] = None,
    match_text: str = "",
) -> Optional[dict]:
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]

    folded_text = _fold_match_text(match_text)
    display_exact = [
        f for f in hits
        if _fold_match_text(flow_display_label(f)) == folded_text
    ]
    if len(display_exact) == 1:
        return display_exact[0]

    if entity_id:
        by_id = [f for f in hits if f.get("entity_id") == entity_id]
        if len(by_id) == 1:
            return by_id[0]
        if len(by_id) > 1:
            hits = by_id

    if entity_name:
        name_l = entity_name.strip().lower()
        by_name = [
            f for f in hits
            if (f.get("entity") or "").strip().lower() == name_l
        ]
        if len(by_name) == 1:
            return by_name[0]
        if len(by_name) > 1:
            hits = by_name

    # Still ambiguous: prefer exact folded label (without category suffix).
    label_only = _fold_match_text(_normalize_match_label(match_text))
    by_label = [
        f for f in hits
        if _fold_match_text(f.get("label") or "") == label_only
    ]
    if len(by_label) == 1:
        return by_label[0]
    if by_label:
        return by_label[0]
    return hits[0]


def resolve_flow_from_match_text(
    flows: Sequence[dict],
    match_text: Any,
    *,
    entity_id: Optional[str] = None,
    entity_name: Optional[str] = None,
) -> Optional[dict]:
    """Resolve a Flow match cell to a cash-flow document.

    Accepts exact UI display ('Label - Category'), exact label, accent-insensitive
    variants, and unique cross-entity hits. When multiple entities share the same
    label, prefers the row entity id/name.
    """
    if match_text is None:
        return None
    text = str(match_text).strip()
    if not text or text.lower() in {"unmatched", "none", "-", "n/a"}:
        return None

    scoped_hits = _find_flows_for_match_text(flows, text, entity_id)
    picked = _prefer_flow_hits(
        scoped_hits,
        entity_id=entity_id,
        entity_name=entity_name,
        match_text=text,
    )
    if picked:
        return picked

    # Entity-scoped miss: search all flows, then disambiguate by entity name/id.
    if entity_id or entity_name:
        global_hits = _find_flows_for_match_text(flows, text, None)
        return _prefer_flow_hits(
            global_hits,
            entity_id=entity_id,
            entity_name=entity_name,
            match_text=text,
        )

    global_hits = _find_flows_for_match_text(flows, text, None)
    return _prefer_flow_hits(global_hits, match_text=text)
