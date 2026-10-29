import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('publication_upgrade', Path(__file__).parents[1] / 'publication_upgrade.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicationUpgradeTests(unittest.TestCase):
    def rows(self):
        return [{'name': f'{n:04}_example.sql', 'sql': f'SELECT {n};'} for n in range(1, 22)]

    def test_exact_baseline_and_all_pending_work_are_inside_one_transaction(self):
        sql = module.render_upgrade(self.rows())
        self.assertEqual(sql.count('\nBEGIN;\n'), 1)
        self.assertEqual(sql.count('\nCOMMIT;\n'), 1)
        self.assertLess(sql.index("pg_advisory_xact_lock"), sql.index('IS DISTINCT FROM'))
        self.assertIn("'0017_example'", sql)
        self.assertNotIn('SELECT 17;', sql)
        self.assertLess(sql.index('SELECT 18;'), sql.index('SELECT 21;'))
        self.assertLess(sql.index("VALUES ('0021_example')"), sql.index('\nCOMMIT;'))

    def test_missing_duplicate_reordered_or_unexpected_inventory_is_rejected(self):
        rows = self.rows()
        for bad in [rows[:-1], rows + [rows[-1]], list(reversed(rows)), [rows[0]] * 21,
                    [{**rows[0], 'name': "0001_bad';SELECT.sql"}, *rows[1:]]]:
            with self.subTest(count=len(bad)):
                with self.assertRaises(ValueError):
                    module.render_upgrade(bad)
