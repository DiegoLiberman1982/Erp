#!/usr/bin/env python3
"""
Set custom_company on Price List documents so that each list belongs to a single company.

Usage:
  python scripts/update_price_list_companies.py --base-url http://erp.local --session-token <SID> --company "MUTANTBAIKY S.A.S."

Options:
  --price-lists   Comma separated list of Price List names to update. When omitted, all price lists are fetched.
  --dry-run       Show planned updates without performing PUT requests.
  --use-cookie    Send the session token as the `sid` cookie instead of `X-Session-Token` header.
"""

import argparse
import json
from urllib.parse import quote

import requests


def fetch_price_list_names(base_url, session):
    url = f"{base_url.rstrip('/')}/api/resource/Price%20List"
    params = {
        "fields": '["name", "price_list_name", "custom_company"]',
        "limit_page_length": 1000,
    }
    print(f"Fetching price lists from {url}")
    resp = session.get(url, params=params)
    resp.raise_for_status()
    data = resp.json().get('data', [])
    print(f"Received {len(data)} price lists")
    return [row['name'] for row in data]


def update_price_list(base_url, session, price_list_name, company, dry_run=False):
    encoded = quote(price_list_name, safe='')
    url = f"{base_url.rstrip('/')}/api/resource/Price%20List/{encoded}"

    resp = session.get(url)
    if not resp.ok:
        print(f"❌ GET {price_list_name} failed: {resp.status_code} {resp.text}")
        return False

    payload = resp.json().get('data') or {}
    current = payload.get('custom_company')
    if current == company:
        print(f"✅ {price_list_name}: already set to {company}")
        return True

    print(f"Updating {price_list_name}: {current} -> {company}")
    if dry_run:
        print("  DRY-RUN skip PUT")
        return True

    update_resp = session.put(url, json={"data": {"custom_company": company}})
    if update_resp.ok:
        print(f"  ✅ PUT success")
        return True

    print(f"  ❌ PUT failed: {update_resp.status_code} {update_resp.text}")
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--session-token', help='ERPNext session ID (SID) to send as X-Session-Token or cookie')
    parser.add_argument('--auth-user', help='User for Authorization header when using API tokens')
    parser.add_argument('--auth-token', help='Token/secret for Authorization header (used with --auth-user)')
    parser.add_argument('--company', required=True, help='Company name to assign to the price lists')
    parser.add_argument('--price-lists', help='Comma separated Price List names to update (optional)')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--use-cookie', action='store_true', help='Send session token as sid cookie instead of X-Session-Token header')
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({'Accept': 'application/json', 'Content-Type': 'application/json'})

    if args.auth_user and args.auth_token:
        session.headers.update({'Authorization': f'token {args.auth_user}:{args.auth_token}'})
        print('Using Authorization token authentication')
    else:
        if not args.session_token:
            raise SystemExit('Provide either --session-token or (--auth-user and --auth-token)')
        if args.use_cookie:
            session.cookies.update({'sid': args.session_token})
            print('Using cookie authentication (sid)')
        else:
            session.headers.update({'X-Session-Token': args.session_token})
            print('Using X-Session-Token header authentication')

    if args.price_lists:
        price_lists = [name.strip() for name in args.price_lists.split(',') if name.strip()]
    else:
        price_lists = fetch_price_list_names(args.base_url, session)

    success = True
    for name in price_lists:
        ok = update_price_list(args.base_url, session, name, args.company, dry_run=args.dry_run)
        success = success and ok

    if success:
        print("All price lists processed")
    else:
        print("Some price lists could not be updated")


if __name__ == '__main__':
    main()
