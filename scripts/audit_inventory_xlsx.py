#!/usr/bin/env python3
"""Read-only OpenXML extractor for the client inventory workbook."""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL_NS = {"p": "http://schemas.openxmlformats.org/package/2006/relationships"}


def col_number(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    result = 0
    for char in letters:
        result = result * 26 + ord(char) - 64
    return result


def main() -> None:
    source = Path(sys.argv[1])
    with zipfile.ZipFile(source) as archive:
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared = ["".join(node.text or "" for node in item.findall(".//m:t", NS)) for item in shared_root.findall("m:si", NS)]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("p:Relationship", REL_NS)}
        result = []
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            name = sheet.attrib["name"]
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]]
            xml_path = "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
            root = ET.fromstring(archive.read(xml_path))
            rows = []
            for row in root.findall("m:sheetData/m:row", NS):
                values = {}
                for cell in row.findall("m:c", NS):
                    ref = cell.attrib["r"]
                    value_node = cell.find("m:v", NS)
                    inline_node = cell.find("m:is", NS)
                    formula_node = cell.find("m:f", NS)
                    raw = value_node.text if value_node is not None else None
                    cell_type = cell.attrib.get("t")
                    if cell_type == "s" and raw is not None:
                        value = shared[int(raw)]
                    elif cell_type == "inlineStr" and inline_node is not None:
                        value = "".join(n.text or "" for n in inline_node.findall(".//m:t", NS))
                    elif cell_type == "b" and raw is not None:
                        value = raw == "1"
                    elif raw is None:
                        value = None
                    else:
                        try:
                            value = float(raw)
                            if value.is_integer(): value = int(value)
                        except ValueError:
                            value = raw
                    values[ref] = {"value": value, "formula": formula_node.text if formula_node is not None else None, "col": col_number(ref)}
                if values:
                    rows.append({"row": int(row.attrib["r"]), "cells": values})
            result.append({"name": name, "dimension": root.find("m:dimension", NS).attrib.get("ref"), "rows": rows})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
