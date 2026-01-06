import csv
import io
import json
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Tuple

import requests

from routes.integrations import DEFAULT_INTEGRATION_SETTINGS, _normalize_settings, _serialize_settings
from utils.http_utils import make_erpnext_request

MERCADOPAGO_BASE_URL = "https://api.mercadopago.com"
DEFAULT_SYNC_DAYS = 3
DEFAULT_TIMEZONE = "GMT-03"


class MercadoPagoSyncError(Exception):
    """Raised when the Mercado Pago sync flow cannot continue."""


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value.replace("Z", "+00:00")
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def _build_range(start_date: Optional[str], end_date: Optional[str], fallback_days: int) -> Tuple[datetime, datetime]:
    utc_now = datetime.now(timezone.utc)
    end_dt = _parse_iso_datetime(end_date) or utc_now
    start_dt = _parse_iso_datetime(start_date) or (end_dt - timedelta(days=max(fallback_days, 1)))
    if start_dt > end_dt:
        start_dt, end_dt = end_dt, start_dt
    return start_dt, end_dt


def _extract_notification_emails(value: Optional[str]) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return value
    return [email.strip() for email in str(value).split(",") if email.strip()]


class MercadoPagoClient:
    def __init__(self, access_token: str):
        if not access_token:
            raise MercadoPagoSyncError("Falta el Access Token de Mercado Pago.")

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        })

    def configure_report(self, prefix: str, timezone_label: str, extra: Optional[dict] = None):
        """
        El endpoint nuevo expone /settlement_report/schedule para programar la generación automática.
        No es obligatorio para nuestro flujo, pero intentamos activarlo para dejar constancia.
        """
        try:
            response = self.session.post(
                f"{MERCADOPAGO_BASE_URL}/v1/account/settlement_report/schedule",
                timeout=30
            )
            if response.status_code >= 400:
                if response.status_code in (400, 403, 404, 405):
                    print(f"[MercadoPago Sync] No se pudo programar el reporte automáticamente ({response.status_code}). Continuamos con generación manual.")
                    return
                raise MercadoPagoSyncError(f"No se pudo programar el reporte automáticamente ({response.status_code}). {response.text}")
        except requests.RequestException as exc:
            print(f"[MercadoPago Sync] Error scheduling settlement report: {exc}")
            raise MercadoPagoSyncError("No se pudo comunicar con Mercado Pago para programar el reporte.") from exc

    def create_report(self, begin_iso: str, end_iso: str) -> str:
        response = self.session.post(
            f"{MERCADOPAGO_BASE_URL}/v1/account/settlement_report",
            json={"begin_date": begin_iso, "end_date": end_iso},
            timeout=30
        )
        if response.status_code >= 400:
            raise MercadoPagoSyncError(f"No se pudo solicitar el reporte ({response.status_code}). {response.text}")
        payload = response.json()
        report_id = payload.get("id") or payload.get("report_id")
        if not report_id:
            raise MercadoPagoSyncError("Mercado Pago no devolvió el ID del reporte solicitado.")
        return str(report_id)

    def wait_for_report(self, report_id: str, expected_start: Optional[datetime] = None,
                        expected_end: Optional[datetime] = None, timeout_seconds: int = 180,
                        poll_interval: int = 5) -> dict:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            response = self.session.get(f"{MERCADOPAGO_BASE_URL}/v1/account/settlement_report/list", timeout=30)
            if response.status_code >= 400:
                raise MercadoPagoSyncError(f"No se pudo consultar el estado del reporte ({response.status_code}). {response.text}")
            payload = response.json()
            reports = payload if isinstance(payload, list) else payload.get("results") or payload.get("data") or []
            for report in reports:
                status = (report.get("status") or "").lower()
                file_name = report.get("file_name")
                report_ids = {
                    str(report.get("id")),
                    str(report.get("report_id")) if report.get("report_id") else None
                }
                report_ids.discard(None)

                id_matches = str(report_id) in report_ids if report_ids else False

                def _parse_iso(value):
                    if not value:
                        return None
                    try:
                        value = value.replace("Z", "+00:00")
                        return datetime.fromisoformat(value)
                    except ValueError:
                        return None

                begin_dt = _parse_iso(report.get("begin_date"))
                end_dt = _parse_iso(report.get("end_date"))

                window_matches = False
                if expected_start and begin_dt:
                    window_matches = abs((begin_dt - expected_start).total_seconds()) < 24 * 3600
                if expected_end and end_dt and window_matches is False:
                    window_matches = abs((end_dt - expected_end).total_seconds()) < 24 * 3600

                if status in {"failed", "error", "cancelled"} and (id_matches or window_matches):
                    raise MercadoPagoSyncError(f"El reporte {report_id} falló en Mercado Pago.")

                if status in {"finished", "ready", "enabled"} and file_name and (id_matches or window_matches):
                    return report
            time.sleep(poll_interval)
        raise MercadoPagoSyncError(f"El reporte {report_id} no se completó en el tiempo esperado.")

    def download_report(self, metadata: dict) -> str:
        file_name = metadata.get("file_name")
        if not file_name:
            raise MercadoPagoSyncError("Mercado Pago no devolvió el nombre del archivo para descargar.")

        response = self.session.get(
            f"{MERCADOPAGO_BASE_URL}/v1/account/settlement_report/{file_name}",
            timeout=60
        )
        if response.status_code >= 400:
            raise MercadoPagoSyncError(f"No se pudo descargar el reporte ({response.status_code}). {response.text}")
        return response.text


def _load_company_integration_settings(session, company: str) -> Dict[str, dict]:
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Company/{company}",
        params={"fields": json.dumps(["name", "custom_integration_settings"])},
        operation_name=f"Get integration settings for {company}"
    )
    if error:
        print(f"[MercadoPago Sync] Error al obtener integraciones para {company}: {error}")
        raise MercadoPagoSyncError("No se pudo obtener la configuración de integraciones de la compañía.")
    company_data = response.json().get("data", {})
    normalized = _normalize_settings(company_data.get("custom_integration_settings"))
    return normalized


def _persist_company_integration_settings(session, company: str, settings: Dict[str, dict]):
    serialized = _serialize_settings(settings)
    response, error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Company/{company}",
        data={"data": {"custom_integration_settings": serialized}},
        operation_name=f"Update integration settings for {company}"
    )
    if error or response.status_code not in (200, 202):
        raise MercadoPagoSyncError("No se pudieron actualizar los datos de integración en ERPNext.")


def _fetch_existing_transaction_keys(session, bank_account: str, company: str, start: datetime, end: datetime) -> Tuple[set, set]:
    filters = [
        ["bank_account", "=", bank_account],
        ["date", ">=", start.strftime("%Y-%m-%d")],
        ["date", "<=", end.strftime("%Y-%m-%d")]
    ]
    if company:
        filters.append(["company", "=", company])
    params = {
        "fields": json.dumps(["name", "reference_number", "transaction_id"]),
        "filters": json.dumps(filters),
        "limit_page_length": 5000,
        "order_by": "date desc"
    }
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Bank Transaction",
        params=params,
        operation_name="Fetch existing bank transactions"
    )
    if error:
        raise MercadoPagoSyncError("No se pudieron leer los movimientos existentes en ERPNext.")

    data = response.json().get("data", [])
    references = {item.get("reference_number") for item in data if item.get("reference_number")}
    transaction_ids = {item.get("transaction_id") for item in data if item.get("transaction_id")}
    return references, transaction_ids


def _map_rows(bank_account: str, rows: List[Dict[str, str]]) -> List[Dict[str, any]]:
    transactions = []
    for row in rows:
        raw_amount = (
            row.get("REAL_AMOUNT")
            or row.get("SETTLEMENT_NET_AMOUNT")
            or row.get("NET_CREDIT")
            or row.get("TRANSACTION_AMOUNT")
            or "0"
        )
        try:
            amount = Decimal(raw_amount)
        except (InvalidOperation, TypeError):
            continue

        if amount == 0:
            continue

        deposit = float(amount) if amount > 0 else 0.0
        withdrawal = float(-amount) if amount < 0 else 0.0
        settlement_date_value = row.get("SETTLEMENT_DATE") or row.get("TRANSACTION_DATE") or row.get("DATE") or ""
        settlement_date = settlement_date_value[:10]
        if not settlement_date:
            continue

        reference = (
            row.get("SOURCE_ID")
            or row.get("EXTERNAL_REFERENCE")
            or row.get("OPERATION_ID")
            or row.get("TRANSACTION_ID")
        )
        transaction_id = (
            row.get("SOURCE_ID")
            or row.get("TRANSACTION_ID")
            or row.get("ORDER_ID")
            or reference
        )
        description_parts = [
            row.get("TRANSACTION_TYPE") or row.get("TYPE"),
            f"ExtRef: {row.get('EXTERNAL_REFERENCE')}" if row.get("EXTERNAL_REFERENCE") else None,
            f"Src: {row.get('SOURCE_ID')}" if row.get("SOURCE_ID") else None,
            f"PM: {row.get('PAYMENT_METHOD_TYPE')}/{row.get('PAYMENT_METHOD')}" if row.get("PAYMENT_METHOD_TYPE") or row.get("PAYMENT_METHOD") else None
        ]
        description = " - ".join([part for part in description_parts if part])

        doc = {
            "doctype": "Bank Transaction",
            "bank_account": bank_account,
            "date": settlement_date,
            "currency": (row.get("SETTLEMENT_CURRENCY") or row.get("TRANSACTION_CURRENCY") or "ARS").upper(),
            "description": description or row.get("DESCRIPTION") or "Movimiento Mercado Pago",
            "reference_number": reference,
            "transaction_id": transaction_id,
            "deposit": deposit,
            "withdrawal": withdrawal,
            "unallocated_amount": deposit or withdrawal,
            "status": "Pending"
        }
        transactions.append(doc)
    return transactions


def _bulk_insert_transactions(session, docs: List[Dict[str, any]]) -> List[str]:
    if not docs:
        return []

    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.insert_many",
        data={"docs": docs},
        operation_name="Bulk insert bank transactions"
    )
    if error:
        raise MercadoPagoSyncError("ERPNext rechazó la importación de movimientos bancarios.")

    payload = response.json() if response else {}
    return payload.get("message") or []


def sync_mercadopago_transactions(session, company: str, bank_account: str, start_date: Optional[str] = None,
                                  end_date: Optional[str] = None, trigger: str = "manual",
                                  manual_file_name: Optional[str] = None) -> Dict[str, any]:
    settings = _load_company_integration_settings(session, company)
    mp_settings = deepcopy(settings.get("mercadopago") or DEFAULT_INTEGRATION_SETTINGS.get("mercadopago") or {})

    has_access_token = bool(mp_settings.get("accessToken"))
    if not mp_settings.get("enabled"):
        if has_access_token:
            print(f"[MercadoPago Sync] Integración marcada como deshabilitada pero hay Access Token cargado para {company}. Continuando con la sincronización.")
        else:
            print(f"[MercadoPago Sync] Integración deshabilitada para {company}. Settings actuales: {mp_settings}")
            raise MercadoPagoSyncError("La integración de Mercado Pago no está habilitada para esta compañía. Activala y guardá las credenciales en Integraciones > Mercado Pago.")

    access_token = mp_settings.get("accessToken")
    if not access_token:
        print(f"[MercadoPago Sync] Access Token faltante para {company}. Settings: {mp_settings}")
        raise MercadoPagoSyncError("No hay Access Token configurado para Mercado Pago. Guardá el Access Token productivo en la configuración de integraciones.")

    sync_days = int(mp_settings.get("defaultSyncDays") or DEFAULT_SYNC_DAYS)
    start_dt, end_dt = _build_range(start_date, end_date, sync_days)
    begin_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    client = MercadoPagoClient(access_token)
    notification_emails = _extract_notification_emails(mp_settings.get("notificationEmails"))
    client.configure_report(
        mp_settings.get("reportPrefix") or f"settlement-report-{company}",
        mp_settings.get("reportTimezone") or DEFAULT_TIMEZONE,
        extra={"notification_email_list": notification_emails}
    )

    if manual_file_name:
        print(f"[MercadoPago Sync] Descargando reporte manual provisto por el usuario: {manual_file_name}")
        csv_content = client.download_report({"file_name": manual_file_name})
        report_id = manual_file_name
        report_metadata = {
            "file_name": manual_file_name,
            "id": manual_file_name,
            "begin_date": start_dt.isoformat() if start_dt else None,
            "end_date": end_dt.isoformat() if end_dt else None
        }
    else:
        report_id = client.create_report(begin_iso, end_iso)
        report_metadata = client.wait_for_report(report_id, expected_start=start_dt, expected_end=end_dt)
        csv_content = client.download_report(report_metadata)

    stream = io.StringIO(csv_content)
    try:
        sample = stream.read(2048)
        stream.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=";,")
    except csv.Error:
        stream.seek(0)
        dialect = csv.excel

    rows = list(csv.DictReader(stream, dialect=dialect))
    if not rows:
        raise MercadoPagoSyncError("El reporte de Mercado Pago no devolvió movimientos para importar.")

    candidate_docs = _map_rows(bank_account, rows)
    if not candidate_docs:
        raise MercadoPagoSyncError("No se pudieron mapear movimientos válidos desde el reporte descargado.")

    existing_refs, existing_ids = _fetch_existing_transaction_keys(session, bank_account, company, start_dt, end_dt)
    new_docs = []
    for doc in candidate_docs:
        ref = doc.get("reference_number")
        tx_id = doc.get("transaction_id")
        if (ref and ref in existing_refs) or (tx_id and tx_id in existing_ids):
            continue
        new_docs.append(doc)

    inserted_names = _bulk_insert_transactions(session, new_docs)

    summary = {
        "bank_account": bank_account,
        "report_id": report_id,
        "report_file_name": report_metadata.get("file_name"),
        "begin_date": start_dt.strftime("%Y-%m-%d"),
        "end_date": end_dt.strftime("%Y-%m-%d"),
        "rows_in_report": len(rows),
        "inserted": len(new_docs),
        "skipped": len(candidate_docs) - len(new_docs),
        "trigger": trigger,
        "inserted_names": inserted_names
    }

    mp_settings["lastSyncAt"] = datetime.now(timezone.utc).isoformat()
    mp_settings["lastReportId"] = report_id
    mp_settings["lastReportFile"] = report_metadata.get("file_name")
    mp_settings["lastSyncRange"] = {"from": summary["begin_date"], "to": summary["end_date"]}
    mp_settings["lastSyncCount"] = summary["inserted"]
    mp_settings["lastSyncStatus"] = "ok"
    settings["mercadopago"] = mp_settings
    _persist_company_integration_settings(session, company, settings)

    return summary
