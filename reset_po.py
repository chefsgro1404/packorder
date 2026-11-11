#!/usr/bin/env python3
"""
Reset ShipScan records for a specific PO name so it can be retested from scratch.
Usage:
  python3 reset_po.py PO1360
  python3 reset_po.py PO1360 "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=..."
"""

import sys
from azure.data.tables import TableServiceClient
from azure.core.exceptions import ResourceNotFoundError

AZURITE_CONN = (
    "DefaultEndpointsProtocol=http;"
    "AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;"
    "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;"
)

def reset_po(po_name: str, conn_str: str):
    svc = TableServiceClient.from_connection_string(conn_str)

    # ── 1. Find the PO row ────────────────────────────────────────────────────
    try:
        po_client = svc.get_table_client("purchaseorders")
        # Accept both "PO1432" and "#PO1432"
        display_name = po_name if po_name.startswith('#') else f"#{po_name}"
        rows = list(po_client.query_entities(f"PoName eq '{display_name}'"))
        if not rows:
            rows = list(po_client.query_entities(f"PoName eq '{po_name}'"))
    except ResourceNotFoundError:
        print(f"[ERROR] Table 'purchaseorders' does not exist — have the functions been started?")
        return

    if not rows:
        print(f"[ERROR] PO '{po_name}' not found in purchaseorders table.")
        return

    po = rows[0]
    numeric_po_id = po["RowKey"]
    print(f"Found PO: {po_name}  (RowKey={numeric_po_id}, Status={po.get('Status','?')})")

    # ── 2. Reset purchaseorders row ───────────────────────────────────────────
    po_client.update_entity({
        "PartitionKey": po["PartitionKey"],
        "RowKey": numeric_po_id,
        "Status": "open",
        "ApprovedLineItems": 0,
    }, mode="merge")
    print(f"  ✓ purchaseorders: reset Status→open, ApprovedLineItems→0")

    # ── 3. Reset all line items for this PO ───────────────────────────────────
    try:
        li_client = svc.get_table_client("purchaseorderlineitems")
        line_items = list(li_client.query_entities(f"PartitionKey eq '{numeric_po_id}'"))
        for li in line_items:
            li_client.update_entity({
                "PartitionKey": numeric_po_id,
                "RowKey": li["RowKey"],
                "Status": "pending",
                "QuantityReceived": 0,
                "PrintedAt": None,
                "PrintedBy": None,
            }, mode="merge")
        print(f"  ✓ purchaseorderlineitems: reset {len(line_items)} line items → pending, qty 0")
    except ResourceNotFoundError:
        print("  – purchaseorderlineitems table not found, skipping")

    # ── 4. Delete bulksessions rows linked to this PO ─────────────────────────
    try:
        bs_client = svc.get_table_client("bulksessions")
        sessions = list(bs_client.query_entities(f"PoId eq 'gid://shopify/InventoryPurchaseOrder/{numeric_po_id}' or PoId eq '{numeric_po_id}'"))
        deleted = 0
        for s in sessions:
            bs_client.delete_entity(s["PartitionKey"], s["RowKey"])
            deleted += 1
        print(f"  ✓ bulksessions: deleted {deleted} session(s)")
    except ResourceNotFoundError:
        print("  – bulksessions table not found, skipping")

    # ── 5. Delete printedlabels rows linked to this PO ────────────────────────
    try:
        pl_client = svc.get_table_client("printedlabels")
        gid_po_id = f"gid://shopify/InventoryPurchaseOrder/{numeric_po_id}"
        labels = list(pl_client.query_entities(
            f"PoId eq '{gid_po_id}' or PoId eq '{numeric_po_id}'"
        ))
        deleted = 0
        for l in labels:
            pl_client.delete_entity(l["PartitionKey"], l["RowKey"])
            deleted += 1
        print(f"  ✓ printedlabels: deleted {deleted} label(s)")
    except ResourceNotFoundError:
        print("  – printedlabels table not found, skipping")

    # ── 6. Delete operation queue jobs linked to this PO ─────────────────────
    # Clears stale 'completed' idempotency entries so approve can run again.
    try:
        jobs_client = svc.get_table_client("operationjobs")
        all_jobs = list(jobs_client.query_entities(""))
        deleted = 0
        for job in all_jobs:
            key = job.get("IdempotencyKey", "") or ""
            if key.startswith(f"{numeric_po_id}:approve-line-item:") or \
               key.startswith(f"{numeric_po_id}:adjust-inventory:"):
                jobs_client.delete_entity(job["PartitionKey"], job["RowKey"])
                deleted += 1
        print(f"  ✓ operationjobs: deleted {deleted} queued/completed job(s)")
    except ResourceNotFoundError:
        print("  – operationjobs table not found, skipping")

    print(f"\nDone. {po_name} is reset — reload the Scale page to retest.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 reset_po.py <PO_NAME> [connection_string]")
        sys.exit(1)
    po_name = sys.argv[1]
    conn_str = sys.argv[2] if len(sys.argv) > 2 else AZURITE_CONN
    reset_po(po_name, conn_str)
