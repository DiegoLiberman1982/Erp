import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

STATE_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'mercadopago_sync_state.json'))


def _ensure_directory():
    directory = os.path.dirname(STATE_FILE)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)


def _load_state() -> Dict[str, Any]:
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r', encoding='utf-8') as handler:
                return json.load(handler)
    except Exception as exc:
        print(f"[TreasurySyncState] Failed to read state file: {exc}")
    return {"accounts": {}}


def _save_state(data: Dict[str, Any]):
    try:
        _ensure_directory()
        with open(STATE_FILE, 'w', encoding='utf-8') as handler:
            json.dump(data, handler, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[TreasurySyncState] Failed to persist state file: {exc}")


def _account_key(company: str, account_name: str) -> str:
    return f"{company}::{account_name}"


def get_account_state(company: str, account_name: str) -> Dict[str, Any]:
    state = _load_state()
    accounts = state.get("accounts", {})
    return accounts.get(_account_key(company, account_name), {})


def set_auto_sync(company: str, account_name: str, enabled: bool) -> Dict[str, Any]:
    state = _load_state()
    accounts = state.setdefault("accounts", {})
    entry = accounts.setdefault(_account_key(company, account_name), {})

    entry["auto_sync_enabled"] = bool(enabled)
    entry["auto_sync_updated_at"] = datetime.now(timezone.utc).isoformat()

    _save_state(state)
    return entry


def record_sync_result(company: str, account_name: str, summary: Dict[str, Any]) -> Dict[str, Any]:
    state = _load_state()
    accounts = state.setdefault("accounts", {})
    entry = accounts.setdefault(_account_key(company, account_name), {})

    entry["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    entry["last_sync_summary"] = summary
    entry["last_report_id"] = summary.get("report_id")
    entry["last_synced_rows"] = summary.get("inserted", 0)

    _save_state(state)
    return entry
