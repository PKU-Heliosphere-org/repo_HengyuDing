"""Generate a tiny artificial workbook for browser tests, never user ephemerides."""
from datetime import datetime
from io import BytesIO
import sys

from openpyxl import Workbook

workbook = Workbook()
notes = workbook.active
notes.title = "说明"
notes.append(["Synthetic orbital elements for automated import tests"])
sheet = workbook.create_sheet("轨道数据")
sheet.append([None] * 7)
sheet.append(["epoch", "a", "e", "i", "raan", "arg_periapsis", "true_anomaly"])
for day, anomaly in [(1, 0), (2, 10), (None, None), (2, 20), (3, 30)]:
    sheet.append([None] * 7 if day is None else [datetime(2026, 1, day), 120000000, 0.2, 10, 30, 20, anomaly])
output = BytesIO()
workbook.save(output)
workbook.close()
sys.stdout.buffer.write(output.getvalue())
