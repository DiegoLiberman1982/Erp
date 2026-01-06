import json
from typing import Any, Dict, List, Optional, Tuple
import requests

from utils.http_utils import make_erpnext_request


def build_company_warehouse_filters(
    company: str,
    *,
    include_disabled: bool = False,
    extra_filters: Optional[List[List[Any]]] = None,
) -> List[List[Any]]:
    filters: List[List[Any]] = []

    if company:
        filters.append(["company", "=", company])

    if not include_disabled:
        filters.append(["disabled", "=", 0])

    if extra_filters:
        filters.extend(extra_filters)

    return filters


def fetch_company_warehouses(
    *,
    session: requests.Session,
    company: str,
    fields: List[str],
    operation_name: str = "Get Warehouses",
    extra_filters: Optional[List[List[Any]]] = None,
    include_disabled: bool = False,
    limit_page_length: int = 1000,
) -> Tuple[Optional[requests.Response], Optional[Dict[str, Any]]]:
    filters = build_company_warehouse_filters(
        company,
        include_disabled=include_disabled,
        extra_filters=extra_filters,
    )

    return make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Warehouse",
        params={
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "limit_page_length": limit_page_length,
        },
        operation_name=operation_name,
    )

