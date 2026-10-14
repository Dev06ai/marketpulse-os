import unittest
import ast
import math
from pathlib import Path
from types import SimpleNamespace
from dataclasses import replace
from app.models import Candle
from app.chart_order_blocks import strong_blocks, select_blocks

HOUR = 3_600_000


def bar(i, o=100., h=101., l=99., c=100., v=100., confirmed=True):
    return Candle(i*HOUR, (i+1)*HOUR-1, o, h, l, c, v, confirmed)


def formation():
    return [bar(i) for i in range(16)] + [bar(16, 100, 101, 99, 99.5),
                                         bar(17, 99.5, 105, 99.4, 104.8, 180)]


class StrongOrderBlocks(unittest.TestCase):
    def test_chart_payload_uses_quality_map_without_reintroducing_legacy_rows(self):
        module = ast.parse((Path(__file__).parent/"app/main.py").read_text(encoding="utf-8"))
        function = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == "chart_overlay_payload")
        scope = {"math": math}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "chart_payload", "exec"), scope)
        strong = strong_blocks(formation(), "1h", 18*HOUR)
        f = SimpleNamespace(chart_order_blocks=strong)
        payload = scope["chart_overlay_payload"](f, {"level_reactions": {"levels": [
            {"kind": "OB", "label": "WEAK OB", "price": 101},
            {"kind": "DAILY", "label": "D LOW", "price": 97}]}})
        self.assertEqual([r for r in payload if r["kind"] == "OB"], strong)
        self.assertEqual(payload[0]["kind"], "DAILY")

    def test_requires_closed_structural_displacement(self):
        cs = formation()
        self.assertEqual(strong_blocks(cs[:-1], "1h", 18*HOUR), [])
        self.assertEqual(strong_blocks(cs, "1h", 18*HOUR-1), [])
        row, = strong_blocks(cs, "1h", 18*HOUR)
        self.assertEqual((row["zone_low"], row["zone_high"]), (99, 101))
        self.assertEqual(row["confirmed_at"], 18*HOUR)
        self.assertGreaterEqual(row["strength_score"], 75)
        self.assertEqual(row["id"], strong_blocks(cs + [bar(18, 105, 107, 104, 106)], "1h", 19*HOUR)[0]["id"])

    def test_weak_low_volume_wrong_base_and_unconfirmed_rejected(self):
        for move in (bar(17, 100, 102, 99.8, 101.2, 180),
                     replace(formation()[-1], volume=100),
                     replace(formation()[-1], confirmed=False),
                     replace(formation()[-1], high=float("nan"))):
            self.assertEqual(strong_blocks(formation()[:-1]+[move], "1h", 18*HOUR), [])
        cs = formation(); cs[-2] = replace(cs[-2], close=100.5)
        self.assertEqual(strong_blocks(cs, "1h", 18*HOUR), [])

    def test_first_boundary_retest_or_invalidation_removes_zone(self):
        for later in (bar(18, 105, 106, 101, 103), bar(18, 98, 98.5, 96, 97)):
            self.assertEqual(strong_blocks(formation()+[later], "1h", 19*HOUR), [])

    def test_missing_history_cannot_prove_freshness(self):
        cs = formation(); del cs[7]
        self.assertEqual(strong_blocks(cs, "1h", 18*HOUR), [])
        self.assertEqual(strong_blocks(formation()+[bar(19, 105, 106, 104, 105)], "1h", 20*HOUR), [])

    def test_bearish_is_symmetric(self):
        cs = [replace(c, open=200-c.open, high=200-c.low, low=200-c.high, close=200-c.close)
              for c in formation()]
        self.assertEqual(strong_blocks(cs, "1h", 18*HOUR)[0]["direction"], "BEARISH")

    def test_selection_caps_deduplicates_and_ignores_far_zones(self):
        template = strong_blocks(formation(), "1h", 18*HOUR)[0]
        rows = [dict(template, id=str(i), zone_low=98+i*2, zone_high=99+i*2,
                     direction="BULLISH" if i<4 else "BEARISH", strength_score=95-i)
                for i in range(8)]
        rows += [dict(rows[0], id="weaker-overlap", strength_score=75),
                 dict(template, id="distant", zone_low=200, zone_high=201)]
        selected = select_blocks(rows, 100)
        self.assertEqual(len(selected), 4)
        self.assertEqual(sum(x["direction"]=="BULLISH" for x in selected), 2)
        self.assertNotIn("weaker-overlap", [r["id"] for r in selected])
        self.assertNotIn("distant", [r["id"] for r in selected])
        self.assertEqual(select_blocks(rows, float("nan")), [])


if __name__ == "__main__":
    unittest.main()
