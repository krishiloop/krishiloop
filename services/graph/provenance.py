"""Provenance graph in Kuzu (embedded graph database), built from our real data.

Nodes:  Pack, Rule(rule_id, version), Source(doc_id, page), Quote(sha256), Receipt(credential id), Area, PhotoModel
Edges:  Rule -IN_PACK-> Pack        Rule -CITES-> Source (a page of a document)   Rule -QUOTES-> Quote
        Quote -QUOTE_ON-> Source    Receipt -USES-> Rule (a rule version)
        Receipt -USES_AREA-> Area   Receipt -USES_MODEL-> PhotoModel (photo-informed advice)

Built from rules/registry/*/*.yaml (through services.engine.rules.load_pack) and from the AdviceReceiptCredentials
in one or more trust-store folders (data/trust/<did>/creds/*.json). The status list and the recall registry stay the
source of truth for what is recalled; the graph answers "which receipts are touched, and which rules share a
source page" by walking edges. Rebuilding is cheap: it is read-only over those files.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import kuzu
import yaml

from services.engine.rules import REGISTRY, load_pack

ROOT = Path(__file__).resolve().parents[2]
MEMORY = ":memory:"
SCHEMA = (
    "CREATE NODE TABLE Pack(pack_id STRING PRIMARY KEY)",
    "CREATE NODE TABLE Rule(key STRING PRIMARY KEY, rule_id STRING, version INT64, pack_id STRING)",
    "CREATE NODE TABLE Source(sid STRING PRIMARY KEY, doc_id STRING, page INT64)",
    "CREATE NODE TABLE Quote(sha256 STRING PRIMARY KEY)",
    "CREATE NODE TABLE Receipt(id STRING PRIMARY KEY, receipt_id STRING, created_at STRING)",
    "CREATE NODE TABLE Area(area STRING PRIMARY KEY)",
    "CREATE NODE TABLE PhotoModel(model STRING PRIMARY KEY)",
    "CREATE REL TABLE IN_PACK(FROM Rule TO Pack)",
    "CREATE REL TABLE CITES(FROM Rule TO Source)",
    "CREATE REL TABLE QUOTES(FROM Rule TO Quote)",
    "CREATE REL TABLE QUOTE_ON(FROM Quote TO Source)",
    "CREATE REL TABLE USES(FROM Receipt TO Rule)",
    "CREATE REL TABLE USES_AREA(FROM Receipt TO Area)",
    "CREATE REL TABLE USES_MODEL(FROM Receipt TO PhotoModel)",
)


def rule_key(rule_id: str, version: int) -> str:
    return f"{rule_id}@{int(version)}"


def default_trust_dirs() -> list[Path]:
    base = ROOT / "data" / "trust"
    return sorted(p for p in base.iterdir() if (p / "creds").is_dir()) if base.is_dir() else []


def _load_dir(pack_dir: Path) -> list[dict]:
    return [yaml.safe_load(p.read_text(encoding="utf-8")) for p in sorted(pack_dir.glob("*.yaml"))]


class ProvGraph:
    def __init__(self, path: str | Path = MEMORY):
        self.path = str(path)
        if self.path != MEMORY:
            p = Path(self.path)
            p.parent.mkdir(parents=True, exist_ok=True)
            for q in (p, p.with_name(p.name + ".wal")):   # a build always starts clean
                if q.is_dir():
                    shutil.rmtree(q)
                elif q.exists():
                    q.unlink()
        self.db = kuzu.Database(self.path)
        self.conn = kuzu.Connection(self.db)
        for ddl in SCHEMA:
            self.conn.execute(ddl)
        self.stats: dict = {}

    # ---------------------------------------------------------------- loading
    def _q(self, query: str, **params):
        return self.conn.execute(query, params)

    def _rows(self, query: str, **params) -> list[list]:
        res, out = self._q(query, **params), []
        while res.has_next():
            out.append(res.get_next())
        return out

    def _add_rule(self, rule_id: str, version: int, pack_id: str) -> str:
        key = rule_key(rule_id, version)
        if not self._rows("MATCH (r:Rule {key: $k}) RETURN r.key", k=key):
            self._q("CREATE (:Rule {key: $k, rule_id: $r, version: $v, pack_id: $p})", k=key, r=rule_id, v=int(version), p=pack_id)
            if pack_id:
                self._q("MERGE (:Pack {pack_id: $p})", p=pack_id)
                self._q("MATCH (r:Rule {key: $k}), (p:Pack {pack_id: $p}) CREATE (r)-[:IN_PACK]->(p)", k=key, p=pack_id)
        return key

    def load_rules(self, registry: Path | None = None) -> None:
        registry = registry or REGISTRY
        for pack_dir in sorted(p for p in registry.iterdir() if p.is_dir()):
            rules = load_pack(pack_dir.name) if registry == REGISTRY else _load_dir(pack_dir)
            for rule in rules:
                key = self._add_rule(rule["rule_id"], rule["version"], rule.get("pack_id") or pack_dir.name)
                for src in rule.get("sources") or []:
                    sid = f"{src['doc_id']}#p{src['page']}"
                    self._q("MERGE (:Source {sid: $s, doc_id: $d, page: $p})", s=sid, d=src["doc_id"], p=int(src["page"]))
                    self._q("MATCH (r:Rule {key: $k}), (s:Source {sid: $s}) CREATE (r)-[:CITES]->(s)", k=key, s=sid)
                    if src.get("quote_sha256"):
                        q = src["quote_sha256"]
                        fresh = not self._rows("MATCH (q:Quote {sha256: $q}) RETURN q.sha256", q=q)
                        self._q("MERGE (:Quote {sha256: $q})", q=q)
                        self._q("MATCH (r:Rule {key: $k}), (q:Quote {sha256: $q}) CREATE (r)-[:QUOTES]->(q)", k=key, q=q)
                        if fresh:
                            self._q("MATCH (q:Quote {sha256: $q}), (s:Source {sid: $s}) CREATE (q)-[:QUOTE_ON]->(s)", q=q, s=sid)

    def load_receipts(self, trust_dirs: list[Path]) -> None:
        for d in trust_dirs:
            for f in sorted((Path(d) / "creds").glob("*.json")):
                try:
                    cred = json.loads(f.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if "AdviceReceiptCredential" not in cred.get("type", []):
                    continue
                subj = cred.get("credentialSubject") or {}
                if self._rows("MATCH (c:Receipt {id: $i}) RETURN c.id", i=cred["id"]):
                    continue
                self._q("CREATE (:Receipt {id: $i, receipt_id: $r, created_at: $t})", i=cred["id"],
                        r=subj.get("receipt_id", ""), t=subj.get("created_at", ""))
                for ref in subj.get("rule_refs") or []:   # an older version no longer in the registry gets a stub node
                    key = self._add_rule(ref["rule_id"], ref["version"], "")
                    self._q("MATCH (c:Receipt {id: $i}), (r:Rule {key: $k}) CREATE (c)-[:USES]->(r)", i=cred["id"], k=key)
                area = subj.get("area_trust_ref")
                if area and area.get("area"):
                    self._q("MERGE (:Area {area: $a})", a=area["area"])
                    self._q("MATCH (c:Receipt {id: $i}), (a:Area {area: $a}) CREATE (c)-[:USES_AREA]->(a)", i=cred["id"], a=area["area"])
                model = ((subj.get("photo_reading") or {}).get("model_ref") or {}).get("model")
                if model:
                    self._q("MERGE (:PhotoModel {model: $m})", m=model)
                    self._q("MATCH (c:Receipt {id: $i}), (m:PhotoModel {model: $m}) CREATE (c)-[:USES_MODEL]->(m)", i=cred["id"], m=model)

    def refresh_stats(self) -> dict:
        for label, name in (("Rule", "rules"), ("Source", "sources"), ("Quote", "quotes"), ("Receipt", "receipts"),
                            ("Pack", "packs"), ("Area", "areas"), ("PhotoModel", "photo_models")):
            self.stats[name] = self._rows(f"MATCH (n:{label}) RETURN count(n)")[0][0]
        self.stats["edges"] = self._rows("MATCH ()-[e]->() RETURN count(e)")[0][0]
        return self.stats

    # ---------------------------------------------------------------- queries (walk the graph)
    def recall_blast_radius(self, rule_id: str, version: int) -> list[str]:
        """Credential ids of every receipt that used this rule version."""
        rows = self._rows("MATCH (c:Receipt)-[:USES]->(r:Rule {key: $k}) RETURN DISTINCT c.id ORDER BY c.id",
                          k=rule_key(rule_id, version))
        return [r[0] for r in rows]

    def rules_citing_same_source(self, rule_id: str, version: int) -> list[dict]:
        """Sibling rules that cite a page this rule also cites: [{rule_id, version, pack_id, source}]."""
        rows = self._rows("MATCH (r:Rule {key: $k})-[:CITES]->(s:Source)<-[:CITES]-(o:Rule) WHERE o.key <> $k "
                          "RETURN DISTINCT o.rule_id, o.version, o.pack_id, s.sid ORDER BY o.rule_id, o.version, s.sid",
                          k=rule_key(rule_id, version))
        return [{"rule_id": a, "version": int(b), "pack_id": c, "source": d} for a, b, c, d in rows]

    def close(self) -> None:
        self.conn.close()
        self.db.close()

    def __enter__(self) -> "ProvGraph":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def build_graph(path: str | Path = MEMORY, trust_dirs: list[Path] | None = None, registry: Path | None = None) -> ProvGraph:
    """Build the provenance graph at `path` (":memory:" for a throwaway one). trust_dirs: trust-store folders to read
    receipts from (default: every folder under data/trust, none if there is none)."""
    g = ProvGraph(path)
    g.load_rules(registry)
    g.load_receipts(default_trust_dirs() if trust_dirs is None else [Path(d) for d in trust_dirs])
    g.refresh_stats()
    return g


def recall_blast_radius(g: ProvGraph, rule_id: str, version: int) -> list[str]:
    return g.recall_blast_radius(rule_id, version)


def rules_citing_same_source(g: ProvGraph, rule_id: str, version: int) -> list[dict]:
    return g.rules_citing_same_source(rule_id, version)


def blast_radius_for_store(store_dir: Path, rule_id: str, version: int) -> dict | None:
    """What a recall touches, from a fresh in-memory graph of the registry plus this store's receipts. On failure
    returns an error note (the status list stays the source of truth either way)."""
    try:
        with build_graph(MEMORY, trust_dirs=[store_dir]) as g:
            receipts = g.recall_blast_radius(rule_id, version)
            return {"engine": f"kuzu {kuzu.__version__}", "receipt_credential_ids": receipts, "receipts": len(receipts),
                    "rules_citing_same_source": g.rules_citing_same_source(rule_id, version),
                    "note": "walked from the provenance graph (Receipt -USES-> Rule); the status list decides what verifies as recalled"}
    except Exception as e:   # never let the graph break a recall
        return {"engine": "kuzu", "error": f"{type(e).__name__}: {e}"[:200]}
