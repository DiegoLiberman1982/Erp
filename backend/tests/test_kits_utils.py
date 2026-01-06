import unittest

from backend.utils.kits_utils import append_company_abbr
from backend.utils.kits_utils import compose_combined_brand


class TestAppendCompanyAbbr(unittest.TestCase):
    def test_append_when_missing(self):
        self.assertEqual(append_company_abbr('ART005', 'MS'), 'ART005 - MS')

    def test_no_double_append(self):
        self.assertEqual(append_company_abbr('ART005 - MS', 'MS'), 'ART005 - MS')

    def test_empty_code(self):
        self.assertEqual(append_company_abbr('', 'MS'), '')

    def test_empty_abbr(self):
        self.assertEqual(append_company_abbr('ART005', ''), 'ART005')

    def test_numeric_item_code(self):
        self.assertEqual(append_company_abbr(123, 'MS'), '123 - MS')

    def test_compose_combined_brand(self):
        self.assertEqual(compose_combined_brand(['A', 'B']), 'A + B')
        self.assertEqual(compose_combined_brand(['B', 'A', 'A']), 'A + B')
        self.assertEqual(compose_combined_brand([]), '')
        self.assertEqual(compose_combined_brand(['', None, ' X ']), 'X')


if __name__ == '__main__':
    unittest.main()
