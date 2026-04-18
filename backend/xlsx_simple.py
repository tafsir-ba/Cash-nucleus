"""
Minimal XLSX first-sheet reader using only stdlib (zipfile + ElementTree).
Used when openpyxl is not installed. Sufficient for typical bank/camt exports.
"""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NS_REL_OFFICE = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_letters_to_index(letters: str) -> int:
    n = 0
    for c in letters.upper():
        if not ("A" <= c <= "Z"):
            break
        n = n * 26 + (ord(c) - ord("A") + 1)
    return n - 1


def _parse_cell_ref(ref: str) -> Tuple[int, int]:
    col_letters = ""
    row_digits = ""
    for ch in ref:
        if ch.isalpha():
            col_letters += ch
        elif ch.isdigit():
            row_digits += ch
    if not row_digits:
        return 0, 0
    return int(row_digits) - 1, _col_letters_to_index(col_letters)


def _read_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    try:
        raw = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    out: List[str] = []
    for si in root.iter():
        if not si.tag.endswith("}si"):
            continue
        parts: List[str] = []
        for t in si.iter():
            if t.tag.endswith("}t") and t.text:
                parts.append(t.text)
        out.append("".join(parts))
    return out


def _first_sheet_target(zf: zipfile.ZipFile) -> str:
    wb = zf.read("xl/workbook.xml")
    root = ET.fromstring(wb)
    first_rid: Optional[str] = None
    for sheet in root.iter():
        if sheet.tag == f"{NS_MAIN}sheet":
            first_rid = sheet.attrib.get(f"{NS_REL_OFFICE}id")
            if not first_rid:
                for ak, av in sheet.attrib.items():
                    if ak.endswith("}id"):
                        first_rid = av
                        break
            if first_rid:
                break
    if not first_rid:
        raise ValueError("Could not find first sheet in workbook.xml")

    rels = zf.read("xl/_rels/workbook.xml.rels")
    rroot = ET.fromstring(rels)
    for rel in rroot.iter():
        if not rel.tag.endswith("Relationship"):
            continue
        rel_id = rel.attrib.get("Id") or rel.attrib.get("id")
        if rel_id == first_rid:
            target = (rel.attrib.get("Target") or "").strip()
            if not target:
                continue
            if ".." in target:
                raise ValueError("Unsupported relative Target in workbook rels")
            if target.startswith("/"):
                target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            return target
    raise ValueError("Could not resolve sheet path from workbook relationships")


def _cell_value(cell: ET.Element, shared_strings: List[str]) -> Any:
    t = cell.attrib.get("t")
    v_el = None
    is_el = None
    for child in cell:
        if child.tag == f"{NS_MAIN}v":
            v_el = child
        elif child.tag == f"{NS_MAIN}is":
            is_el = child
    if is_el is not None:
        parts: List[str] = []
        for tnode in is_el.iter():
            if tnode.tag == f"{NS_MAIN}t" and tnode.text:
                parts.append(tnode.text)
        return "".join(parts)
    if v_el is None or v_el.text is None:
        return None
    text = v_el.text
    if t == "s":
        try:
            idx = int(text)
            return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
        except (ValueError, IndexError):
            return text
    if t == "str" or t == "inlineStr":
        return text
    try:
        if "." in text or "E" in text or "e" in text:
            return float(text)
        return int(text)
    except ValueError:
        return text


def read_first_sheet_as_dict_rows(content: bytes) -> Tuple[List[str], List[Dict[str, Any]]]:
    """
    Returns (column_names_from_header_row, list_of_row_dicts).
    Row dict keys are header strings; duplicate headers get suffix _2, _3.
    """
    zf = zipfile.ZipFile(io.BytesIO(content), "r")
    try:
        sst = _read_shared_strings(zf)
        sheet_path = _first_sheet_target(zf)
        sheet_xml = zf.read(sheet_path)
    finally:
        zf.close()

    root = ET.fromstring(sheet_xml)
    sparse: Dict[int, Dict[int, Any]] = {}
    max_col = 0
    for cell in root.iter():
        if cell.tag != f"{NS_MAIN}c":
            continue
        ref = cell.attrib.get("r")
        if not ref:
            continue
        row_i, col_i = _parse_cell_ref(ref)
        val = _cell_value(cell, sst)
        sparse.setdefault(row_i, {})[col_i] = val
        max_col = max(max_col, col_i)

    if not sparse:
        raise ValueError("Empty sheet")

    sorted_rows = sorted(sparse.keys())
    header_row_idx = sorted_rows[0]
    header_cells = sparse[header_row_idx]
    raw_headers: List[str] = []
    for c in range(max_col + 1):
        v = header_cells.get(c)
        raw_headers.append(str(v).strip() if v is not None else f"column_{c+1}")

    used: Dict[str, int] = {}
    headers: List[str] = []
    for h in raw_headers:
        base = h or "column"
        n = used.get(base, 0) + 1
        used[base] = n
        headers.append(base if n == 1 else f"{base}_{n}")

    out_rows: List[Dict[str, Any]] = []
    for r in sorted_rows[1:]:
        row_map: Dict[str, Any] = {}
        cells = sparse.get(r, {})
        empty = True
        for c in range(max_col + 1):
            key = headers[c]
            val = cells.get(c)
            if val not in (None, ""):
                empty = False
            row_map[key] = val
        if not empty:
            out_rows.append(row_map)

    return headers, out_rows
