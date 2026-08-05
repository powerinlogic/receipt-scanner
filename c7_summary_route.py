# ─────────────────────────────────────────────────────────────────────────────
# DROP-IN for receipt-scanner/app.py
#
# Paste this block into app.py directly AFTER the existing api_c7_proxy()
# function and BEFORE the "# ── API: Stats ──" ... actually anywhere above the
# "# ── Run ──" section is fine. Recommended: right after api_c7_proxy().
#
# Two imports must be added at the top of app.py (both stdlib):
#     import time
#     from collections import defaultdict
#
# Nothing else changes. Auth is inherited from the existing @app.before_request
# _require_auth hook, which already accepts ?token=<AGENT_API_TOKEN>.
# ─────────────────────────────────────────────────────────────────────────────

C7_BASE = "https://api.commerce7.com/v1"
C7_PAGE_LIMIT = 50          # Commerce7 max page size for /order
C7_MAX_PAGES = 400          # hard stop; 400 * 50 = 20,000 orders
C7_TIME_BUDGET_SEC = 100    # stop paginating past this and report truncated


def _c7_first(obj, *keys, default=None):
    """Return the first present, non-None key from a dict. Commerce7 field
    names vary by object type and API version; this keeps one bad guess from
    silently zeroing a tax figure."""
    if not isinstance(obj, dict):
        return default
    for k in keys:
        v = obj.get(k)
        if v is not None:
            return v
    return default


def _c7_cents(val):
    """Commerce7 money fields are integer cents. Coerce defensively without
    ever silently turning a real number into 0."""
    if val is None:
        return 0
    if isinstance(val, bool):
        return 0
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(round(val))
    try:
        return int(round(float(val)))
    except (TypeError, ValueError):
        return 0


@app.route("/api/agent/c7-summary")
def api_c7_summary():
    """
    Aggregate Commerce7 order line items over a date range, in ONE request.

    GET /api/agent/c7-summary?from=2026-05-01&to=2026-06-30&token=...

    Exists because Claude's fetch proxy can only retrieve URLs that have
    appeared verbatim in the conversation, so a 35-page paginated pull built
    from a template is unreachable. This endpoint does the pagination
    server-side and returns one small JSON.

    Deliberately does NOT compute gallons. The pour-size mapping is a
    compliance judgment that belongs in the backbone's run_instructions where
    it can be read and audited, not baked into a server where it drifts
    invisibly. This returns product name + quantity + cents; the caller does
    the tax math.

    Optional params:
      debug=1   return the first raw order object verbatim and stop. Use this
                first if the aggregate looks wrong — it shows the real field
                names instead of making you guess.
      top=N     cap the products list at the N highest-quantity rows
                (default: no cap). Totals are always computed over ALL rows,
                never just the returned ones.
    """
    if not (C7_APP_ID and C7_APP_SECRET and C7_TENANT):
        return jsonify({"error": "C7_APP_ID / C7_APP_SECRET / C7_TENANT not configured"}), 503

    date_from = (request.args.get("from") or "").strip()
    date_to = (request.args.get("to") or "").strip()
    for label, val in (("from", date_from), ("to", date_to)):
        if not val:
            return jsonify({"error": f"'{label}' is required (YYYY-MM-DD)"}), 400
        try:
            datetime.strptime(val, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": f"'{label}' must be YYYY-MM-DD, got {val!r}"}), 400
    if date_from > date_to:
        return jsonify({"error": f"'from' ({date_from}) is after 'to' ({date_to})"}), 400

    debug = request.args.get("debug") == "1"
    try:
        top = int(request.args.get("top", "0"))
    except ValueError:
        top = 0

    # ── paginate ─────────────────────────────────────────────────────────────
    session = _requests.Session()
    started = time.monotonic()

    products = defaultdict(lambda: {"qty": 0, "cents": 0, "orders": 0})
    by_status = defaultdict(int)
    by_delivery = defaultdict(int)
    ship_states = defaultdict(int)

    orders_seen = 0
    pages_fetched = 0
    order_total_cents = 0
    refund_cents = 0
    orders_with_no_items = 0
    reported_total = None
    truncated = None
    first_raw = None
    seen_order_ids = set()

    page = 1
    while page <= C7_MAX_PAGES:
        if time.monotonic() - started > C7_TIME_BUDGET_SEC:
            truncated = f"time budget of {C7_TIME_BUDGET_SEC}s exceeded after {pages_fetched} pages"
            break
        try:
            resp = session.get(
                f"{C7_BASE}/order",
                params={
                    "orderPaidDate": f"btw:{date_from}|{date_to}",
                    "limit": C7_PAGE_LIMIT,
                    "page": page,
                },
                auth=(C7_APP_ID, C7_APP_SECRET),
                headers={"tenant": C7_TENANT},
                timeout=30,
            )
        except _requests.RequestException as e:
            return jsonify({
                "error": f"commerce7 unreachable on page {page}: {e}",
                "partial": True,
                "pages_fetched": pages_fetched,
                "orders_seen": orders_seen,
            }), 502

        if not resp.ok:
            return jsonify({
                "error": f"commerce7 returned {resp.status_code} on page {page}",
                "body": resp.text[:500],
                "partial": True,
                "pages_fetched": pages_fetched,
                "orders_seen": orders_seen,
            }), resp.status_code

        try:
            body = resp.json()
        except ValueError:
            return jsonify({
                "error": f"commerce7 returned non-JSON on page {page}",
                "body": resp.text[:500],
            }), 502

        pages_fetched += 1
        orders = _c7_first(body, "orders", "data", "results", default=[])
        if not isinstance(orders, list):
            return jsonify({
                "error": "could not find an order list in the Commerce7 response",
                "top_level_keys": sorted(body.keys()) if isinstance(body, dict) else str(type(body)),
                "hint": "call again with &debug=1 to see the raw payload",
            }), 502

        if reported_total is None:
            reported_total = _c7_first(body, "total", "totalCount", "count")

        if not orders:
            break

        if first_raw is None:
            first_raw = orders[0]
            if debug:
                return jsonify({
                    "debug": True,
                    "note": "First raw Commerce7 order object, verbatim. Use this to "
                            "confirm field names, then drop &debug=1.",
                    "range": {"from": date_from, "to": date_to},
                    "reported_total": reported_total,
                    "page_top_level_keys": sorted(body.keys()) if isinstance(body, dict) else None,
                    "order": first_raw,
                })

        for order in orders:
            oid = _c7_first(order, "id", "orderId", "orderNumber")
            if oid is not None:
                if oid in seen_order_ids:
                    continue          # defensive: unstable pagination can repeat rows
                seen_order_ids.add(oid)
            orders_seen += 1

            order_total_cents += _c7_cents(_c7_first(order, "total", "totalAfterTip", "grandTotal"))
            refund_cents += _c7_cents(_c7_first(order, "refundAmount", "totalRefund", default=0))

            by_status[str(_c7_first(order, "paymentStatus", "financialStatus", "status", default="unknown"))] += 1
            by_delivery[str(_c7_first(order, "orderDeliveryMethod", "channel", "orderType", default="unknown"))] += 1

            ship_to = _c7_first(order, "shipTo", "shippingAddress", default={}) or {}
            state = _c7_first(ship_to, "stateCode", "state", "province", default=None)
            ship_states[str(state) if state else "none"] += 1

            items = _c7_first(order, "items", "orderItems", "lineItems", default=None)
            if not isinstance(items, list) or not items:
                orders_with_no_items += 1
                continue

            for it in items:
                if not isinstance(it, dict):
                    continue
                title = _c7_first(it, "productTitle", "title", "productName", "name", default="(untitled)")
                sku = _c7_first(it, "sku", "productSku", default="")
                dept = _c7_first(it, "departmentCode", "department", "productType", default="")
                key = (str(title), str(sku), str(dept))

                qty = _c7_first(it, "quantity", "qty", default=0)
                try:
                    qty = int(qty)
                except (TypeError, ValueError):
                    qty = 0

                line_cents = _c7_cents(_c7_first(it, "totalAfterDiscount", "total", "subTotal", default=None))
                if not line_cents:
                    line_cents = _c7_cents(_c7_first(it, "price", default=0)) * max(qty, 0)

                bucket = products[key]
                bucket["qty"] += qty
                bucket["cents"] += line_cents
                bucket["orders"] += 1

        if len(orders) < C7_PAGE_LIMIT:
            break
        page += 1
    else:
        truncated = f"hit the {C7_MAX_PAGES}-page safety cap"

    # ── shape the response ───────────────────────────────────────────────────
    rows = [
        {"title": t, "sku": s, "department": d,
         "qty": v["qty"], "cents": v["cents"], "orders": v["orders"]}
        for (t, s, d), v in products.items()
    ]
    rows.sort(key=lambda r: (-r["qty"], -r["cents"], r["title"]))

    totals = {
        "distinct_products": len(rows),
        "line_qty": sum(r["qty"] for r in rows),
        "line_cents": sum(r["cents"] for r in rows),
        "order_total_cents": order_total_cents,
        "refund_cents": refund_cents,
    }

    returned = rows[:top] if top and top > 0 else rows

    warnings = []
    if truncated:
        warnings.append(
            f"INCOMPLETE — {truncated}. These figures understate the period and "
            "must NOT be used on a filing."
        )
    if reported_total is not None and orders_seen and reported_total != orders_seen:
        warnings.append(
            f"Commerce7 reported {reported_total} orders for this range but "
            f"{orders_seen} were aggregated. Investigate before filing."
        )
    if orders_with_no_items:
        warnings.append(
            f"{orders_with_no_items} order(s) had no readable line items. Private-event "
            "packages often post as a single payment line with the wine inside it, so "
            "bottles in those orders are invisible here."
        )
    if top and len(rows) > len(returned):
        warnings.append(
            f"products[] truncated to top {len(returned)} of {len(rows)} by qty; "
            "totals above still cover all rows."
        )
    if not rows:
        warnings.append("No line items aggregated. Call again with &debug=1 to inspect the raw order shape.")

    return jsonify({
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "range": {"from": date_from, "to": date_to},
        "fetch": {
            "pages": pages_fetched,
            "orders_aggregated": orders_seen,
            "commerce7_reported_total": reported_total,
            "elapsed_sec": round(time.monotonic() - started, 1),
            "complete": truncated is None,
        },
        "totals": totals,
        "products": returned,
        "by_payment_status": dict(sorted(by_status.items(), key=lambda kv: -kv[1])),
        "by_delivery_method": dict(sorted(by_delivery.items(), key=lambda kv: -kv[1])),
        "ship_to_state_order_counts": dict(sorted(ship_states.items(), key=lambda kv: -kv[1])),
        "warnings": warnings,
    })
