def test_script_is_strict_and_uses_item_tax_templates():
    # Read the server script source directly to avoid importing the whole package
    path = 'backend/routes/erpnext_scripts.py'
    with open(path, 'r', encoding='utf-8') as f:
        script = f.read()

    # Find the server-script string literal to assert the script content only
    marker = "BULK_ITEM_IVA_SCRIPT = \"\"\""
    start = script.find(marker)
    assert start != -1, "BULK_ITEM_IVA_SCRIPT marker missing"
    end_marker = '""".strip()'
    end = script.find(end_marker, start)
    assert end != -1, "BULK_ITEM_IVA_SCRIPT end marker missing"
    server_script = script[start + len(marker):end]

    # Should attempt to use request.get_json (strict contract)
    assert 'get_json' in server_script or "req.json" in server_script

    # No fallbacks allowed: form_dict and wrapper unwrapping MUST NOT be present in the server script
    assert 'form_dict' not in server_script
    assert "'data' in data" not in server_script and "'args' in data" not in server_script and "'kwargs' in data" not in server_script

    # Should require per-item item_tax_templates and validate templates via get_doc
    assert 'item_tax_templates' in server_script
    assert "frappe.get_doc('Item Tax Template'" in server_script or 'frappe.get_doc(\"Item Tax Template\"' in server_script

    # Should not require company anymore (server script context)
    assert 'Company is required' not in server_script

    # Must not use augmented assignment on subscriptions (disallowed by RestrictedPython)
    assert "+=" not in server_script
