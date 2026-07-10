"""
spare_po_service.py — Controlled Spare Parts PO import and analysis.

Data model (Phase 8):
  spare_po_lines          — PO Spare 24-26.csv  → base table for ALL PO analysis
  inventory_item_mapping  — On-hand list.xlsx   → stock snapshot / item mapping only
  Gen PO (spare_parts_views) → enrichment/reference only (never the base)

Join rules:
  PO Spare ↔ Gen PO:   po_number = PO No.  AND  item_code = Item number
  PO Spare ↔ Inventory: item_code = item_number

Left-join only — no PO Spare rows are ever dropped due to missing enrichment.
"""

import csv
import os
import re
from datetime import datetime
from pathlib import Path

import openpyxl

import db as _db

# ── Canonical file paths ───────────────────────────────────────────────────────
_DEFAULT_DATA_DIR   = Path(__file__).resolve().parent.parent / "data"
_SPARE_IMPORT_DIR   = _DEFAULT_DATA_DIR / "spare_parts_imports"
PO_SPARE_CANONICAL      = _SPARE_IMPORT_DIR / "po_spare_24_26.csv"
INV_MAPPING_CANONICAL   = _SPARE_IMPORT_DIR / "inventory_item_mapping.xlsx"

# ── In-process memo caches (invalidated on import) ───────────────────────────
_PO_SPARE_MEMO   = {"sig": None, "rows": None}
_INV_MAP_MEMO    = {"sig": None, "rows": None}
_ENRICHED_MEMO   = {"sig": None, "payload": None}

# ── Display column label map ──────────────────────────────────────────────────
DISPLAY_LABELS = {
    "po_number":               "PO No.",
    "item_code":               "Item Code",
    "item_description":        "Spare Part Description",
    "ordered_qty":             "Ordered Qty",
    "uom":                     "UOM",
    "unit_price":              "Unit Price",
    "currency":                "Currency",
    "po_value_thb":            "PO Value THB",
    "requested_delivery_date": "Requested Delivery Date",
    "pr_no":                   "PR No.",
    "vendor_name":             "Vendor Name",
    "grn_status":              "Procurement / GRN Status",
    "supplier_lead_time":      "Supplier Lead Time",
    "actual_delivery_days":    "Actual Delivery Days",
    "approval_status":         "Approval Status",
    "capex_opex":              "CAPEX / OPEX",
    "cost_group":              "Group of Cost",
    "sub_cost":                "Sub-Cost",
    "available_stock":         "Available Stock",
    "physical_stock":          "Physical Stock",
    "total_available_stock":   "Total Available Stock",
    "on_order_qty":            "On Order Qty",
    "ordered_in_total":        "Ordered in Total",
    "item_group":              "Item Group",
    "stock_status":            "Stock Status",
    "inventory_match_status":  "Inventory Match",
    "gen_po_match_status":     "Gen PO Match",
}

# ── Match-status labels ────────────────────────────────────────────────────────
MS_MATCHED_INV   = "Matched inventory spare part"
MS_PO_ONLY_INV   = "PO spare item not found in inventory mapping"
MS_PO_ONLY_GENPO = "PO Spare only / controlled spare PO line not found in Gen PO reference"
MS_GENPO_EXTRA   = "Gen PO spare-like line not in controlled PO Spare import"
MS_INV_NO_PO     = "Inventory item with no PO Spare 24-26 line"


# ── Utility ────────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    """Normalise a header string for alias matching."""
    return re.sub(r"[^a-z0-9]", "", str(s or "").strip().lower())


def _file_sig(path: Path):
    try:
        s = os.stat(path)
        return (s.st_mtime_ns, s.st_size)
    except OSError:
        return None


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# ── File management ───────────────────────────────────────────────────────────

def _stage_and_promote(file_storage, canonical: Path) -> Path:
    """Save an uploaded file to its canonical location (atomic replace)."""
    canonical.parent.mkdir(parents=True, exist_ok=True)
    suffix = Path(file_storage.filename or "upload").suffix or ".csv"
    tmp = canonical.with_suffix(".tmp" + suffix)
    file_storage.save(str(tmp))
    tmp.replace(canonical)
    return canonical


# ── CSV / Excel row readers ────────────────────────────────────────────────────

def _read_csv_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


def _read_excel_rows(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not all_rows:
        return []
    headers = [str(h or "").strip() for h in all_rows[0]]
    return [
        {h: v for h, v in zip(headers, row)}
        for row in all_rows[1:]
        if any(v is not None for v in row)
    ]


def _read_file(path: Path) -> list[dict]:
    if path.suffix.lower() in (".xlsx", ".xls"):
        return _read_excel_rows(path)
    return _read_csv_rows(path)


# ── Parsers ────────────────────────────────────────────────────────────────────

def _parse_po_spare(path: Path) -> list[dict]:
    """
    Parse PO Spare 24-26.csv (or .xlsx).
    Columns: PurchaseOrderNumber, Item No., Item Description, Qty, UOM,
             U/P, Currency, Total_inTHB, RequestedDeliveryDate
    """
    FIELD_ALIASES = {
        "po_number":               ["purchaseordernumber", "pono", "ponumber", "ordernumber", "purchaseorder"],
        "item_code":               ["itemno", "itemcode", "itemnumber", "partno", "partcode", "code", "itemno"],
        "item_description":        ["itemdescription", "description", "itemname", "partname", "sparepartname", "itemdesc"],
        "ordered_qty":             ["qty", "quantity", "orderedqty", "qtyordered", "orderqty"],
        "uom":                     ["uom", "unit", "unitofmeasure", "um"],
        "unit_price":              ["up", "unitprice", "priceunit", "price", "unitcost", "uprice"],
        "currency":                ["currency", "curr", "ccy"],
        "po_value_thb":            ["totalinthb", "totalthb", "amountthb", "total", "totalvalue", "valueinthb", "totalinthb"],
        "requested_delivery_date": ["requesteddeliverydate", "deliverydate", "requestdate", "duedate", "reqdeliverydate"],
    }
    col_map: dict[str, str] = {}
    for field, aliases in FIELD_ALIASES.items():
        for a in aliases:
            col_map[_norm(a)] = field

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    rows_out = []

    for raw in _read_file(path):
        mapped: dict[str, str] = {}
        for col, val in raw.items():
            field = col_map.get(_norm(col))
            if field and val is not None and str(val).strip():
                mapped.setdefault(field, str(val).strip())

        po   = mapped.get("po_number", "").upper()
        item = mapped.get("item_code", "").upper()
        if not po and not item:
            continue  # blank row

        rows_out.append({
            "po_number":               po,
            "item_code":               item,
            "item_description":        mapped.get("item_description", ""),
            "ordered_qty":             _safe_float(mapped.get("ordered_qty")),
            "uom":                     mapped.get("uom", ""),
            "unit_price":              _safe_float(mapped.get("unit_price")),
            "currency":                mapped.get("currency", "THB"),
            "po_value_thb":            _safe_float(mapped.get("po_value_thb")),
            "requested_delivery_date": mapped.get("requested_delivery_date", ""),
            "source_file":             path.name,
            "updated_at":              now,
        })
    return rows_out


def _parse_inventory_mapping(path: Path) -> list[dict]:
    """
    Parse On-hand list.xlsx as inventory item mapping.
    Used for stock snapshot and item-code lookup only — NOT as a PO source.
    """
    FIELD_ALIASES = {
        "item_number":        ["itemnumber", "itemno", "itemcode", "partno", "code", "item"],
        "product_name":       ["productname", "itemname", "description", "itemdescription", "searchname", "name"],
        "inventory_unit":     ["inventoryunit", "unit", "uom", "inventoryunitofmeasure"],
        "item_group":         ["itemgroup", "productgroup", "partgroup", "group"],
        "available_physical": ["availablephysical", "availqty", "available", "availableqty", "availphysical"],
        "physical_inventory": ["physicalinventory", "physqty", "physicalstock", "physinventory"],
        "total_available":    ["totalavailable", "totalstock", "totalqty"],
        "on_order":           ["onorder", "onorderqty", "ordered"],
        "ordered_in_total":   ["orderedintotal", "totalordered"],
        "vendor_name":        ["vendorname", "supplier", "vendor", "vendornameid"],
        "stock_status":       ["stockstatus", "status", "itemstatus"],
    }
    col_map: dict[str, str] = {}
    for field, aliases in FIELD_ALIASES.items():
        for a in aliases:
            col_map[_norm(a)] = field

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    rows_out = []

    for raw in _read_file(path):
        mapped: dict[str, str] = {}
        for col, val in raw.items():
            field = col_map.get(_norm(col))
            if field and val is not None and str(val).strip():
                mapped.setdefault(field, str(val).strip())

        item_no = mapped.get("item_number", "").upper()
        if not item_no:
            continue

        rows_out.append({
            "item_number":        item_no,
            "product_name":       mapped.get("product_name", ""),
            "inventory_unit":     mapped.get("inventory_unit", ""),
            "item_group":         mapped.get("item_group", ""),
            "available_physical": _safe_float(mapped.get("available_physical")),
            "physical_inventory": _safe_float(mapped.get("physical_inventory")),
            "total_available":    _safe_float(mapped.get("total_available")),
            "on_order":           _safe_float(mapped.get("on_order")),
            "ordered_in_total":   _safe_float(mapped.get("ordered_in_total")),
            "vendor_name":        mapped.get("vendor_name", ""),
            "stock_status":       mapped.get("stock_status", ""),
            "source_file":        path.name,
            "updated_at":         now,
        })
    return rows_out


# ── Import handlers ────────────────────────────────────────────────────────────

def import_po_spare_file(file_storage) -> dict:
    """Import PO Spare 24-26.csv (or .xlsx). Returns {ok, message, row_count}."""
    try:
        dest = _stage_and_promote(file_storage, PO_SPARE_CANONICAL)
        rows = _parse_po_spare(dest)
        if not rows:
            return {"ok": False, "message": "No data rows found in the uploaded file."}
        _db.upsert_spare_po_lines(rows)
        _PO_SPARE_MEMO["sig"] = None
        _ENRICHED_MEMO["sig"] = None
        return {"ok": True, "message": f"Imported {len(rows):,} PO Spare lines from {dest.name}.", "row_count": len(rows)}
    except Exception as exc:
        return {"ok": False, "message": f"Import failed: {exc}"}


def import_inventory_mapping_file(file_storage) -> dict:
    """Import On-hand list.xlsx as inventory item mapping. Returns {ok, message, row_count}."""
    try:
        dest = _stage_and_promote(file_storage, INV_MAPPING_CANONICAL)
        rows = _parse_inventory_mapping(dest)
        if not rows:
            return {"ok": False, "message": "No data rows found in the uploaded file."}
        _db.upsert_inventory_item_mapping(rows)
        _INV_MAP_MEMO["sig"] = None
        _ENRICHED_MEMO["sig"] = None
        return {"ok": True, "message": f"Imported {len(rows):,} inventory items from {dest.name}.", "row_count": len(rows)}
    except Exception as exc:
        return {"ok": False, "message": f"Import failed: {exc}"}


# ── Data loaders ───────────────────────────────────────────────────────────────

def load_po_spare_lines() -> list[dict]:
    """Load PO Spare lines from DB, auto-seeding from canonical CSV if DB is empty."""
    sig = _file_sig(PO_SPARE_CANONICAL)
    if sig and _PO_SPARE_MEMO["sig"] == sig and _PO_SPARE_MEMO["rows"] is not None:
        return _PO_SPARE_MEMO["rows"]
    rows = _db.load_spare_po_lines()
    if not rows and PO_SPARE_CANONICAL.exists():
        parsed = _parse_po_spare(PO_SPARE_CANONICAL)
        if parsed:
            _db.upsert_spare_po_lines(parsed)
            rows = _db.load_spare_po_lines()
    _PO_SPARE_MEMO.update(sig=sig, rows=rows)
    return rows


def load_inventory_mapping() -> list[dict]:
    """Load inventory item mapping from DB, auto-seeding from canonical file if DB is empty."""
    sig = _file_sig(INV_MAPPING_CANONICAL)
    if sig and _INV_MAP_MEMO["sig"] == sig and _INV_MAP_MEMO["rows"] is not None:
        return _INV_MAP_MEMO["rows"]
    rows = _db.load_inventory_item_mapping()
    if not rows and INV_MAPPING_CANONICAL.exists():
        parsed = _parse_inventory_mapping(INV_MAPPING_CANONICAL)
        if parsed:
            _db.upsert_inventory_item_mapping(parsed)
            rows = _db.load_inventory_item_mapping()
    _INV_MAP_MEMO.update(sig=sig, rows=rows)
    return rows


def _load_gen_po_index() -> dict[tuple[str, str], dict]:
    """
    Load Gen PO rows from spare_parts_views and index by (PO_NO_UPPER, ITEM_NO_UPPER).
    Returns {} if Gen PO is not imported.
    """
    try:
        import spare_parts_views as spv
        gr_rows = spv.get_goods_received_rows()
        index: dict[tuple[str, str], dict] = {}
        for row in gr_rows:
            po   = str(row.get("po_number") or row.get("PO No.") or "").strip().upper()
            item = str(row.get("item_number") or row.get("Item number") or "").strip().upper()
            key  = (po, item)
            if key not in index:
                index[key] = row
            # Also index by PO-only and item-only for partial fallback
            if po and (po, "") not in index:
                index[(po, "")] = row
        return index
    except Exception:
        return {}


# ── Enriched view ──────────────────────────────────────────────────────────────

def _build_enriched(po_lines: list[dict], inv_index: dict, gp_index: dict) -> list[dict]:
    """
    Left-join PO Spare lines with Gen PO and Inventory.
    Base table = PO Spare — zero rows dropped.
    """
    enriched = []
    for row in po_lines:
        po_no  = str(row.get("po_number")  or "").upper()
        item   = str(row.get("item_code")  or "").upper()

        # Gen PO: exact (PO, item) match first, then PO-only fallback
        gp = gp_index.get((po_no, item)) or gp_index.get((po_no, "")) or {}
        # Inventory: by item code
        inv = inv_index.get(item, {})

        inv_status  = MS_MATCHED_INV   if inv  else MS_PO_ONLY_INV
        gp_status   = ""               if gp   else MS_PO_ONLY_GENPO

        enriched.append({
            # Core PO Spare fields (source of truth)
            "po_number":               row.get("po_number", ""),
            "item_code":               row.get("item_code", ""),
            "item_description":        row.get("item_description", ""),
            "ordered_qty":             row.get("ordered_qty"),
            "uom":                     row.get("uom", ""),
            "unit_price":              row.get("unit_price"),
            "currency":                row.get("currency", "THB"),
            "po_value_thb":            row.get("po_value_thb"),
            "requested_delivery_date": row.get("requested_delivery_date", ""),
            # Gen PO enrichment (blank when not matched — value always from PO Spare)
            "pr_no":               gp.get("pr_number") or gp.get("PR No.", ""),
            "vendor_name":         gp.get("vendor_name") or gp.get("Vendor name", ""),
            "grn_status":          gp.get("pr_po_grn_status") or gp.get("PR PO GRN Status", ""),
            "supplier_lead_time":  gp.get("lead_time") or gp.get("Lead time delivery", ""),
            "actual_delivery_days":gp.get("grn_po_days") or gp.get("GRN-PO date", ""),
            "approval_status":     gp.get("kpi_status") or gp.get("KPI Status", ""),
            "capex_opex":          gp.get("type_of_cost") or gp.get("Type of cost", ""),
            "cost_group":          gp.get("group_of_cost") or gp.get("Group of cost", ""),
            "sub_cost":            gp.get("sub_cost") or gp.get("Sub-Cost", ""),
            # Inventory enrichment (stock snapshot only)
            "available_stock":      inv.get("available_physical"),
            "physical_stock":       inv.get("physical_inventory"),
            "total_available_stock":inv.get("total_available"),
            "on_order_qty":         inv.get("on_order"),
            "ordered_in_total":     inv.get("ordered_in_total"),
            "item_group":           inv.get("item_group", ""),
            "stock_status":         inv.get("stock_status", ""),
            # Match status flags
            "inventory_match_status": inv_status,
            "gen_po_match_status":    gp_status,
            "has_gen_po_match":       bool(gp),
            "has_inventory_match":    bool(inv),
        })
    return enriched


# ── KPI / payload builders ─────────────────────────────────────────────────────

def build_spare_po_payload(year: str = "", month: str = "") -> dict:
    """
    Full payload for the PO Spare Analysis tab.
    Base table: PO Spare 24-26.csv. Gen PO and inventory are enrichment only.
    No PO Spare rows are dropped due to missing enrichment.
    """
    po_lines = load_po_spare_lines()
    inv_rows = load_inventory_mapping()
    inv_index = {r["item_number"]: r for r in inv_rows if r.get("item_number")}
    gp_index  = _load_gen_po_index()

    enriched = _build_enriched(po_lines, inv_index, gp_index)

    # ── Period filter ─────────────────────────────────────────────────────────
    def in_period(row: dict) -> bool:
        d = str(row.get("requested_delivery_date") or "")[:10]
        if year and not d.startswith(year):
            return False
        if month:
            if d[:7] != (month[:7] if len(month) >= 7 else month):
                return False
        return True

    filtered = [r for r in enriched if in_period(r)] if (year or month) else enriched

    # ── KPIs (always from PO Spare 24-26.csv) ────────────────────────────────
    total_value = sum(float(r["po_value_thb"] or 0) for r in filtered if r.get("po_value_thb") is not None)
    po_numbers  = {r["po_number"] for r in filtered if r.get("po_number")}
    item_codes  = {r["item_code"]  for r in filtered if r.get("item_code")}
    total_qty   = sum(float(r["ordered_qty"] or 0) for r in filtered if r.get("ordered_qty") is not None)
    dates       = sorted(d for r in filtered for d in [str(r.get("requested_delivery_date") or "")[:10]] if d >= "2020")
    date_range  = (f"{dates[0]} → {dates[-1]}") if len(dates) >= 2 else (dates[0] if dates else "—")

    kpis = {
        "total_po_value_thb":  round(total_value, 2),
        "po_count":            len(po_numbers),
        "po_line_count":       len(filtered),
        "unique_item_count":   len(item_codes),
        "total_ordered_qty":   round(total_qty, 2),
        "date_range":          date_range,
        "total_rows":          len(enriched),
        "filtered_rows":       len(filtered),
    }

    # ── Top purchased items ───────────────────────────────────────────────────
    item_agg: dict[str, dict] = {}
    for r in filtered:
        code = r.get("item_code") or "—"
        if code not in item_agg:
            item_agg[code] = {
                "item_code":              code,
                "item_description":       r.get("item_description") or "—",
                "total_value_thb":        0.0,
                "total_qty":              0.0,
                "po_line_count":          0,
                "unique_po_count":        set(),
                "item_group":             r.get("item_group") or "",
                "vendor_name":            r.get("vendor_name") or "",
                "inventory_match_status": r.get("inventory_match_status") or "",
                "available_stock":        r.get("available_stock"),
            }
        item_agg[code]["total_value_thb"] += float(r.get("po_value_thb") or 0)
        item_agg[code]["total_qty"]       += float(r.get("ordered_qty") or 0)
        item_agg[code]["po_line_count"]   += 1
        if r.get("po_number"):
            item_agg[code]["unique_po_count"].add(r["po_number"])

    top_items = sorted(item_agg.values(), key=lambda x: x["total_value_thb"], reverse=True)[:20]
    for itm in top_items:
        itm["unique_po_count"]  = len(itm["unique_po_count"])
        itm["total_value_thb"]  = round(itm["total_value_thb"], 2)
        itm["total_qty"]        = round(itm["total_qty"], 2)

    # ── Monthly trend ─────────────────────────────────────────────────────────
    monthly: dict[str, dict] = {}
    for r in filtered:
        ym = str(r.get("requested_delivery_date") or "")[:7]
        ym = ym if ym >= "2020" else "Unknown"
        if ym not in monthly:
            monthly[ym] = {"period": ym, "value_thb": 0.0, "line_count": 0, "po_set": set()}
        monthly[ym]["value_thb"]  += float(r.get("po_value_thb") or 0)
        monthly[ym]["line_count"] += 1
        if r.get("po_number"):
            monthly[ym]["po_set"].add(r["po_number"])

    monthly_trend = [
        {
            "period":     m["period"],
            "value_thb":  round(m["value_thb"], 2),
            "line_count": m["line_count"],
            "po_count":   len(m["po_set"]),
        }
        for _, m in sorted(monthly.items())
    ]

    # ── Yearly trend ─────────────────────────────────────────────────────────
    yearly: dict[str, dict] = {}
    for r in filtered:
        yr = str(r.get("requested_delivery_date") or "")[:4]
        yr = yr if yr >= "2020" else "Unknown"
        if yr not in yearly:
            yearly[yr] = {"year": yr, "value_thb": 0.0, "line_count": 0, "po_set": set()}
        yearly[yr]["value_thb"]  += float(r.get("po_value_thb") or 0)
        yearly[yr]["line_count"] += 1
        if r.get("po_number"):
            yearly[yr]["po_set"].add(r["po_number"])

    yearly_trend = [
        {
            "year":       d["year"],
            "value_thb":  round(d["value_thb"], 2),
            "line_count": d["line_count"],
            "po_count":   len(d["po_set"]),
        }
        for _, d in sorted(yearly.items())
    ]

    # ── Reconciliation summary ────────────────────────────────────────────────
    recon = _build_reconciliation(enriched, inv_index)

    return {
        "kpis":          kpis,
        "top_items":     top_items,
        "monthly_trend": monthly_trend,
        "yearly_trend":  yearly_trend,
        "reconciliation":recon,
        "display_labels":DISPLAY_LABELS,
        "source_note": (
            "PO Spare 24-26.csv is used as the controlled spare parts PO import. "
            "Gen PO is used as procurement reference/enrichment only. "
            "On-hand list.xlsx is used only as item mapping and stock snapshot, not as the PO source."
        ),
    }


def _build_reconciliation(enriched: list[dict], inv_index: dict) -> dict:
    """Data confidence / reconciliation summary."""
    total_value = sum(float(r["po_value_thb"] or 0) for r in enriched if r.get("po_value_thb") is not None)
    matched_gp  = sum(1 for r in enriched if r.get("has_gen_po_match"))
    po_items    = {r["item_code"] for r in enriched if r.get("item_code")}
    inv_items   = set(inv_index.keys())
    inv_no_po   = inv_items - po_items
    return {
        "total_po_spare_rows":               len(enriched),
        "total_po_spare_value_thb":          round(total_value, 2),
        "rows_matched_to_gen_po":            matched_gp,
        "rows_not_matched_to_gen_po":        len(enriched) - matched_gp,
        "items_matched_to_inventory":        len(po_items & inv_items),
        "items_not_in_inventory_mapping":    len(po_items - inv_items),
        "inventory_items_with_no_po_spare":  len(inv_no_po),
        "labels": {
            "matched_inventory":  MS_MATCHED_INV,
            "po_only_inv":        MS_PO_ONLY_INV,
            "po_spare_only":      MS_PO_ONLY_GENPO,
            "gen_po_extra":       MS_GENPO_EXTRA,
            "inv_no_po":          MS_INV_NO_PO,
        },
    }


# ── Import status ─────────────────────────────────────────────────────────────

def get_import_status() -> dict:
    """Status of PO Spare and Inventory Mapping imports for the import panel."""
    def _meta(path: Path, rows: list[dict], count_label: str) -> dict:
        try:
            st = os.stat(path)
            return {
                "uploaded": True,
                "file_name": path.name,
                "row_count": len(rows),
                "imported_at": datetime.utcfromtimestamp(st.st_mtime).isoformat(timespec="seconds") + "Z",
            }
        except OSError:
            return {"uploaded": bool(rows), "row_count": len(rows)}

    po_rows  = _db.load_spare_po_lines()
    inv_rows = _db.load_inventory_item_mapping()
    return {
        "PO Spare":          _meta(PO_SPARE_CANONICAL, po_rows, "lines"),
        "Inventory Mapping": _meta(INV_MAPPING_CANONICAL, inv_rows, "items"),
    }
