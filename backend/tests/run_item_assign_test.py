import sys
from pathlib import Path

# Ensure the repository root and backend are on sys.path so imports resolve when run from workspace root
workspace_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(workspace_root / 'backend'))

import routes.items as items_module

class DummyResp:
    def __init__(self, status_code=200, text='{}'):
        self.status_code = status_code
        self.text = text

calls = []

def fake_make_erpnext_request(session, method, endpoint, data=None, params=None, custom_headers=None, operation_name=None, _fiscal_retry=False):
    calls.append((method, endpoint, data))
    if method == 'GET':
        return DummyResp(200), None
    if method == 'PUT':
        return DummyResp(200), None
    return None, {'success': False}

items_module.make_erpnext_request = fake_make_erpnext_request

items_module.assign_tax_template_by_rate('ART001', 21.0, session=None, headers={}, company='TestCo', rate_to_template_map={'21.0': 'IVA 21'})
print('Calls when item exists:', calls)

# Reset and test when GET returns 404
calls = []

def fake_make_erpnext_request_2(session, method, endpoint, data=None, params=None, custom_headers=None, operation_name=None, _fiscal_retry=False):
    calls.append((method, endpoint, data))
    if method == 'GET':
        return None, {'status_code': 404, 'message': 'Not found'}
    if method == 'PUT':
        return DummyResp(200), None
    return None, {'success': False}

items_module.make_erpnext_request = fake_make_erpnext_request_2
items_module.get_company_abbr = lambda s,h,c: 'ANC'

items_module.assign_tax_template_by_rate('ART006', 21.0, session=None, headers={}, company='ADRIANA NOEMI', rate_to_template_map={'21.0': 'IVA 21'})
print('Calls when item missing:', calls)
