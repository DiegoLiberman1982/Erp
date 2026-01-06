from flask import Blueprint, jsonify, request

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company
from services.mercadopago_service import MercadoPagoSyncError, sync_mercadopago_transactions
from services.treasury_sync_state import record_sync_result

mercadopago_bp = Blueprint('mercadopago', __name__)


@mercadopago_bp.route('/api/mercadopago/sync', methods=['POST'])
def mercadopago_sync():
    print("=== DEBUG: mercadopago_sync called ===")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("DEBUG: Authentication error when syncing Mercado Pago")
        return error_response

    payload = request.get_json(silent=True) or {}
    print(f"DEBUG: Payload recibido para sync: {payload}")
    bank_account = payload.get("bankAccount")
    if not bank_account:
        return jsonify({"success": False, "message": "Debe indicar la cuenta bancaria a sincronizar."}), 400

    start_date = payload.get("startDate")
    end_date = payload.get("endDate")
    trigger = payload.get("trigger") or "manual"
    file_name = payload.get("fileName")

    active_company = request.headers.get('X-Active-Company') or get_active_company(user_id)
    if not active_company:
        return jsonify({"success": False, "message": "No hay una compañía activa seleccionada."}), 400

    try:
        print(f"DEBUG: Iniciando sync Mercado Pago para compañía {active_company} y cuenta {bank_account}")
        summary = sync_mercadopago_transactions(
            session=session,
            company=active_company,
            bank_account=bank_account,
            start_date=start_date,
            end_date=end_date,
            trigger=trigger,
            manual_file_name=file_name
        )
    except MercadoPagoSyncError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        print(f"[MercadoPago Sync] Unexpected error: {exc}")
        return jsonify({"success": False, "message": "Error interno al sincronizar movimientos de Mercado Pago."}), 500

    state = record_sync_result(active_company, bank_account, summary)

    return jsonify({
        "success": True,
        "message": f"Sincronización completada. Nuevos movimientos: {summary.get('inserted', 0)}",
        "data": {
            "summary": summary,
            "state": state
        }
    })
