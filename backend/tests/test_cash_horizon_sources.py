from cash_horizon_sources import build_source_catalog, parse_source_selector


def test_parse_source_selector():
    assert parse_source_selector("manual") is None
    assert parse_source_selector("treasury_account:abc") == {"kind": "treasury_account", "ref_id": "abc"}
    assert parse_source_selector("bexio:evohom") == {"kind": "bexio", "ref_id": "evohom"}
    assert parse_source_selector("evonucleus_pl:invoiced_open") == {
        "kind": "evonucleus_pl",
        "ref_id": "invoiced_open",
    }
    assert parse_source_selector("bad") is None


def test_build_source_catalog_includes_manageable_and_placeholder():
    catalog = build_source_catalog(
        accounts=[
            {
                "id": "a1",
                "entity": "Evohom SA",
                "label": "Operating",
                "amount": 120000,
                "balance_source": "manual",
                "is_receivables_financing": False,
            },
            {
                "id": "a2",
                "entity": "Evohom SA",
                "label": "Receivables",
                "amount": 198577,
                "balance_source": "bexio",
                "bexio_connection": "evohom",
                "is_receivables_financing": True,
            },
        ],
        debts=[
            {
                "source_flow_id": "d1",
                "creditor": "Magalie",
                "entity": "Evohom SA",
                "total_debt_chf": 153000,
                "monthly_payment_chf": 153000,
            }
        ],
        bexio_connections=[
            {"id": "evohom", "label": "Evohom SA", "configured": True},
            {"id": "evahomes", "label": "Evahomes SA", "configured": False},
        ],
    )
    kinds = {g["kind"] for g in catalog["groups"]}
    assert kinds == {"treasury_account", "bexio", "treasury_debt", "evonucleus_pl"}
    items = {i["id"]: i for i in catalog["items"]}
    assert items["treasury_account:a1"]["enabled"] is True
    assert items["treasury_account:a1"]["amount"] == 120000
    assert items["bexio:evohom"]["enabled"] is True
    assert items["bexio:evohom"]["amount"] == 198577
    assert items["bexio:evahomes"]["enabled"] is False
    assert items["treasury_debt:d1"]["amount"] == 153000
    assert items["evonucleus_pl:default"]["enabled"] is False
    # Available for both inflow and outflow quadrants where relevant
    assert "confirmed_inflow" in items["treasury_account:a1"]["suggested_quadrants"]
    assert "confirmed_outflow" in items["treasury_account:a1"]["suggested_quadrants"]
    assert "confirmed_outflow" in items["treasury_debt:d1"]["suggested_quadrants"]


def test_build_source_catalog_with_live_evonucleus_metrics():
    catalog = build_source_catalog(
        accounts=[],
        debts=[],
        bexio_connections=[],
        evonucleus_metrics=[
            {
                "ref_id": "invoiced_open",
                "label": "Invoiced (Open)",
                "subtitle": "Open AR already invoiced",
                "amount": 68588,
                "enabled": True,
                "suggested_quadrants": ["confirmed_inflow", "potential_inflow"],
            },
            {
                "ref_id": "uninvoiced_open",
                "label": "Uninvoiced (Open)",
                "subtitle": "Open AR not yet invoiced",
                "amount": 67577,
                "enabled": True,
                "suggested_quadrants": ["potential_inflow", "confirmed_inflow"],
            },
            {
                "ref_id": "arr_potential",
                "label": "ARR potential",
                "subtitle": "Maintenance annual recurring potential",
                "amount": 5835.0,
                "enabled": True,
                "suggested_quadrants": ["potential_inflow", "confirmed_inflow"],
            },
            {
                "ref_id": "vendor_remaining",
                "label": "Vendor costs remaining",
                "subtitle": "Sum of vendor remaining",
                "amount": 4200,
                "enabled": True,
                "suggested_quadrants": ["confirmed_outflow", "potential_outflow"],
            },
        ],
    )
    items = {i["id"]: i for i in catalog["items"]}
    assert "evonucleus_pl:default" not in items
    assert items["evonucleus_pl:invoiced_open"]["amount"] == 68588
    assert items["evonucleus_pl:uninvoiced_open"]["amount"] == 67577
    assert items["evonucleus_pl:arr_potential"]["amount"] == 5835.0
    assert items["evonucleus_pl:vendor_remaining"]["enabled"] is True
    assert "confirmed_outflow" in items["evonucleus_pl:vendor_remaining"]["suggested_quadrants"]
    group = next(g for g in catalog["groups"] if g["kind"] == "evonucleus_pl")
    assert group["label"] == "Evonucleus P&L"
    assert len(group["items"]) == 4
