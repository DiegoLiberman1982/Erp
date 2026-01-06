from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any, Callable, Dict, Iterable, List, Set, Tuple

CONCILIATION_FIELD = "custom_conciliation_id"
DEFAULT_THRESHOLD = 0.01


def generate_conciliation_id(prefix: str = "CONC") -> str:
    """Return a readable unique identifier to group documents manually."""
    timestamp = datetime.now().strftime("%Y%m%d")
    random_suffix = uuid.uuid4().hex[:6].upper()
    return f"{prefix}-{timestamp}-{random_suffix}"


def _safe_amount(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def build_conciliation_groups(
    documents: Iterable[Dict[str, Any]],
    amount_getter: Callable[[Dict[str, Any]], float],
    threshold: float = DEFAULT_THRESHOLD,
) -> Tuple[Dict[str, Dict[str, Any]], Set[str]]:
    """Group documents by conciliation_id and compute the net amount per group."""
    groups: Dict[str, Dict[str, Any]] = {}
    for doc in documents:
        group_id = doc.get(CONCILIATION_FIELD)
        if not group_id:
            continue
        amount = _safe_amount(amount_getter(doc))
        group = groups.setdefault(group_id, {"documents": [], "net_amount": 0.0})
        group["documents"].append(doc)
        group["net_amount"] += amount

    balanced_ids = {
        group_id for group_id, data in groups.items() if abs(data["net_amount"]) < threshold
    }
    return groups, balanced_ids


def exclude_balanced_documents(
    documents: Iterable[Dict[str, Any]],
    balanced_ids: Set[str],
) -> List[Dict[str, Any]]:
    """Return only the documents whose conciliation remains unbalanced."""
    return [
        doc for doc in documents
        if doc.get(CONCILIATION_FIELD) not in balanced_ids
    ]


def summarize_group_balances(groups: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return a compact summary that is easy to return to the frontend."""
    summaries: List[Dict[str, Any]] = []
    for group_id, data in groups.items():
        summaries.append({
            "conciliation_id": group_id,
            "net_amount": data.get("net_amount", 0.0),
            "documents": data.get("documents", []),
        })
    return summaries
