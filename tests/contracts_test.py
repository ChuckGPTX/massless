"""Contract library check: every template in public/office/contracts/ against the template schema, plus the catalog and states.json.

Checks, for every <id>.json template:
  - the exact top-level schema (keys, types, enums, CC0-1.0 license, ISO lastReviewed date);
  - every {{variable}} in a section body is declared, and every declared variable is used (in a body or a showIf);
  - every [[kind:role(:label)]] marker is well formed and names a declared role;
  - every showIf has the form `var == 'value'`, `var != 'value'` or `var == true|false`, names a declared variable,
    uses true/false only with bool variables and only values listed in a select variable's options;
  - every role has at least one [[sig:role]] and [[date:role]] marker;
  - a disclaimer that says it is not legal advice and recommends an attorney, non-empty sources with http(s) URLs,
    watch-outs, and unique role, variable and section ids;
  - stateAware templates have a `state` select whose options are exactly the 51 jurisdictions in states.json.
And: no duplicate ids; index.json lists every template exactly once with matching title, category and summary;
states.json covers all 50 states and DC, and every claim in it carries at least one source URL.

  python3 tests/contracts_test.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "office", "contracts")

CATEGORIES = {"everyday", "business", "real-estate", "creative-finance", "music", "joint-venture"}
VAR_TYPES = {"date", "text", "longtext", "money", "percent", "number", "address", "email", "select", "bool", "party"}
TOP_KEYS = ["id", "version", "title", "category", "summary", "useWhen", "watchOuts", "jurisdiction", "stateAware",
            "roles", "variables", "sections", "disclaimer", "sources", "license", "lastReviewed"]
VAR_KEYS = {"id", "label", "type", "required", "default", "options", "help"}
SECTION_KEYS = {"id", "title", "body", "optional"}
JURISDICTIONS = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
                 "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
                 "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"}
STATE_CLAIMS = ["purchaseContractForms", "sellerDisclosure", "closingPractice", "eSignatureAndNotarization",
                "executoryContracts", "wholesaling", "landlordTenant"]

ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
VAR_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")
ROLE_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_RE = re.compile(r"^https?://[^\s]+\.[^\s]+$")
PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
MARKER_RE = re.compile(r"\[\[([^\[\]]*)\]\]")
SHOWIF_RE = re.compile(r"^([a-z][a-z0-9_]*)\s*(==|!=)\s*(?:'([^']*)'|(true|false))$")

errors = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def check_sources(where, sources):
    if not isinstance(sources, list) or not sources:
        return err(where, "needs a non-empty sources list")
    for i, s in enumerate(sources):
        if not isinstance(s, dict) or set(s) != {"title", "url"}:
            err(where, f"source {i} must be {{title, url}}")
            continue
        if not isinstance(s["title"], str) or not s["title"].strip():
            err(where, f"source {i} has no title")
        if not isinstance(s["url"], str) or not URL_RE.match(s["url"]):
            err(where, f"source {i} has a bad url: {s.get('url')!r}")


def check_template(path, state_codes):
    name = os.path.basename(path)
    try:
        t = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        return err(name, f"invalid JSON: {e}")
    if not isinstance(t, dict):
        return err(name, "must be an object")
    if list(t.keys()) != TOP_KEYS and set(t.keys()) != set(TOP_KEYS):
        missing, extra = set(TOP_KEYS) - set(t), set(t) - set(TOP_KEYS)
        return err(name, f"top-level keys differ from the schema (missing {sorted(missing)}, extra {sorted(extra)})")

    # top-level fields
    if not isinstance(t["id"], str) or not ID_RE.match(t["id"]):
        err(name, f"bad id {t['id']!r}")
    if name != f"{t['id']}.json":
        err(name, f"file name must be {t['id']}.json")
    if not isinstance(t["version"], int) or isinstance(t["version"], bool) or t["version"] < 1:
        err(name, "version must be a positive integer")
    for k in ("title", "summary", "useWhen", "jurisdiction", "disclaimer"):
        if not isinstance(t[k], str) or not t[k].strip():
            err(name, f"{k} must be a non-empty string")
    if t["category"] not in CATEGORIES:
        err(name, f"bad category {t['category']!r}")
    if not isinstance(t["stateAware"], bool):
        err(name, "stateAware must be a boolean")
    if not isinstance(t["watchOuts"], list) or not t["watchOuts"] or not all(isinstance(w, str) and w.strip() for w in t["watchOuts"]):
        err(name, "watchOuts must be a non-empty list of strings")
    if t["license"] != "CC0-1.0":
        err(name, "license must be CC0-1.0")
    if not isinstance(t["lastReviewed"], str) or not DATE_RE.match(t["lastReviewed"]):
        err(name, "lastReviewed must be YYYY-MM-DD")
    d = t["disclaimer"].lower()
    if "not legal advice" not in d or "attorney" not in d:
        err(name, "disclaimer must say it is not legal advice and recommend an attorney")
    check_sources(name, t["sources"])

    # roles
    roles = t["roles"]
    role_ids = set()
    if not isinstance(roles, list) or not roles:
        err(name, "roles must be a non-empty list")
        roles = []
    for r in roles:
        if not isinstance(r, dict) or set(r) != {"id", "label"}:
            err(name, f"role must be {{id, label}}: {r!r}")
            continue
        if not ROLE_ID_RE.match(str(r["id"])):
            err(name, f"bad role id {r['id']!r}")
        if r["id"] in role_ids:
            err(name, f"duplicate role id {r['id']}")
        if not isinstance(r["label"], str) or not r["label"].strip():
            err(name, f"role {r['id']} needs a label")
        role_ids.add(r["id"])

    # variables
    variables = {}
    for v in t["variables"] if isinstance(t["variables"], list) else []:
        where = f"{name} variable {v.get('id') if isinstance(v, dict) else v!r}"
        if not isinstance(v, dict) or set(v) != VAR_KEYS:
            err(where, f"keys must be {sorted(VAR_KEYS)}")
            continue
        if not isinstance(v["id"], str) or not VAR_ID_RE.match(v["id"]):
            err(where, "bad variable id")
        if v["id"] in variables:
            err(where, "duplicate variable id")
        if v["type"] not in VAR_TYPES:
            err(where, f"bad type {v['type']!r}")
        if not isinstance(v["required"], bool):
            err(where, "required must be a boolean")
        for k in ("label", "help"):
            if not isinstance(v[k], str) or not v[k].strip():
                err(where, f"{k} must be a non-empty string")
        if not isinstance(v["default"], str):
            err(where, "default must be a string")
        if not isinstance(v["options"], list) or not all(isinstance(o, str) for o in v["options"]):
            err(where, "options must be a list of strings")
        elif v["type"] == "select":
            if len(v["options"]) < 2:
                err(where, "select needs at least two options")
            if len(set(v["options"])) != len(v["options"]):
                err(where, "duplicate select options")
            if v["default"] and v["default"] not in v["options"]:
                err(where, f"default {v['default']!r} is not one of the options")
            if any("'" in o for o in v["options"]):
                err(where, "select options must not contain single quotes (they break showIf)")
        elif v["options"]:
            err(where, "only select variables may have options")
        if v["type"] == "bool" and v["default"] not in ("", "true", "false"):
            err(where, "bool default must be '', 'true' or 'false'")
        variables[v["id"]] = v
    if not variables:
        err(name, "needs variables")

    # sections
    used = set()
    seen_markers = {r: set() for r in role_ids}
    section_ids = set()
    if not isinstance(t["sections"], list) or not t["sections"]:
        err(name, "sections must be a non-empty list")
    for s in t["sections"] if isinstance(t["sections"], list) else []:
        where = f"{name} section {s.get('id') if isinstance(s, dict) else '?'}"
        if not isinstance(s, dict) or not SECTION_KEYS <= set(s) or not set(s) <= SECTION_KEYS | {"showIf"}:
            err(where, "keys must be id, title, body, optional and optionally showIf")
            continue
        if s["id"] in section_ids:
            err(where, "duplicate section id")
        section_ids.add(s["id"])
        for k in ("id", "title", "body"):
            if not isinstance(s[k], str) or not s[k].strip():
                err(where, f"{k} must be a non-empty string")
        if not isinstance(s["optional"], bool):
            err(where, "optional must be a boolean")
        text = f"{s['title']}\n{s['body']}"
        # placeholders
        for m in PLACEHOLDER_RE.finditer(text):
            vid = m.group(1)
            if vid not in variables:
                err(where, f"undeclared variable {{{{{vid}}}}}")
            used.add(vid)
        stripped = PLACEHOLDER_RE.sub("", text)
        if "{{" in stripped or "}}" in stripped:
            err(where, "unbalanced {{ }} placeholder")
        # markers
        for m in MARKER_RE.finditer(s["body"]):
            parts = m.group(1).split(":")
            kind = parts[0]
            if kind in ("sig", "initial", "date", "name"):
                if len(parts) != 2:
                    err(where, f"marker [[{m.group(1)}]] must be [[{kind}:role]]")
                    continue
            elif kind in ("text", "check"):
                if len(parts) != 3 or not parts[2].strip():
                    err(where, f"marker [[{m.group(1)}]] must be [[{kind}:role:Label]]")
                    continue
            else:
                err(where, f"unknown marker kind in [[{m.group(1)}]]")
                continue
            if parts[1] not in role_ids:
                err(where, f"marker [[{m.group(1)}]] names unknown role {parts[1]!r}")
                continue
            seen_markers[parts[1]].add(kind)
        if "[[" in MARKER_RE.sub("", s["body"]) or "]]" in MARKER_RE.sub("", s["body"]):
            err(where, "unbalanced [[ ]] marker")
        if s["title"].count("[[") or MARKER_RE.search(s["title"]):
            err(where, "markers belong in the body, not the title")
        # showIf
        if "showIf" in s:
            m = SHOWIF_RE.match(s["showIf"].strip()) if isinstance(s["showIf"], str) else None
            if not m:
                err(where, f"bad showIf {s.get('showIf')!r}")
            else:
                vid, op, sval, bval = m.groups()
                used.add(vid)
                v = variables.get(vid)
                if not v:
                    err(where, f"showIf names unknown variable {vid!r}")
                elif bval is not None and v["type"] != "bool":
                    err(where, f"showIf compares non-bool {vid} with {bval}")
                elif sval is not None and v["type"] == "bool":
                    err(where, f"showIf compares bool {vid} with a string")
                elif sval is not None and v["type"] == "select" and sval not in v["options"]:
                    err(where, f"showIf value {sval!r} is not an option of {vid}")
                if not s["optional"]:
                    err(where, "a section with showIf must be optional")
    for vid in variables:
        if vid not in used:
            err(name, f"declared variable {vid!r} is never used")
    for r in role_ids:
        if "sig" not in seen_markers[r]:
            err(name, f"role {r!r} has no [[sig:{r}]] signature marker")
        if "date" not in seen_markers[r]:
            err(name, f"role {r!r} has no [[date:{r}]] marker")

    # state-aware templates
    if t["stateAware"]:
        sv = variables.get("state")
        if not sv or sv["type"] != "select":
            err(name, "stateAware templates need a `state` select variable")
        elif set(sv["options"]) != state_codes or len(sv["options"]) != len(state_codes):
            err(name, "`state` options must be exactly the jurisdictions in states.json")
    return t


def check_claim(where, claim):
    if not isinstance(claim, dict):
        return err(where, "claim must be an object")
    check_sources(where, claim.get("sources"))
    for k, v in claim.items():
        if isinstance(v, dict) and k != "sources":
            check_claim(f"{where}.{k}", v)


def check_states():
    path = os.path.join(DIR, "states.json")
    try:
        data = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        err("states.json", f"invalid JSON: {e}")
        return set()
    for k in ("lastChecked", "disclaimer", "federal", "states"):
        if k not in data:
            err("states.json", f"missing {k}")
    if not DATE_RE.match(str(data.get("lastChecked", ""))):
        err("states.json", "lastChecked must be YYYY-MM-DD")
    states = data.get("states", {})
    codes = set(states)
    if codes != JURISDICTIONS:
        err("states.json", f"must cover the 50 states and DC exactly (missing {sorted(JURISDICTIONS - codes)}, extra {sorted(codes - JURISDICTIONS)})")
    for code, st in states.items():
        where = f"states.json {code}"
        if st.get("code") != code or not st.get("name"):
            err(where, "needs matching code and a name")
        if not DATE_RE.match(str(st.get("lastChecked", ""))):
            err(where, "lastChecked must be YYYY-MM-DD")
        for c in STATE_CLAIMS:
            if c not in st:
                err(where, f"missing {c}")
            else:
                check_claim(f"{where}.{c}", st[c])
        for k, v in st.items():
            if isinstance(v, dict) and k not in STATE_CLAIMS:
                check_claim(f"{where}.{k}", v)
    fed = data.get("federal", {})
    if not fed:
        err("states.json", "federal notes are empty")
    for k in ("leadBasedPaint", "dueOnSale", "sellerFinancing"):
        if k not in fed:
            err("states.json", f"federal.{k} is missing")
    for k, v in fed.items():
        check_claim(f"states.json federal.{k}", v)
    return codes


def main():
    if not os.path.isdir(DIR):
        print(f"FAIL: {DIR} does not exist")
        return 1
    state_codes = check_states() or JURISDICTIONS
    files = sorted(f for f in os.listdir(DIR) if f.endswith(".json") and f not in ("index.json", "states.json"))
    templates = [t for t in (check_template(os.path.join(DIR, f), state_codes) for f in files) if isinstance(t, dict)]
    ids = [t.get("id") for t in templates]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        err("library", f"duplicate template ids {dups}")
    if len(templates) < 40:
        err("library", f"expected at least 40 templates, found {len(templates)}")

    try:
        index = json.load(open(os.path.join(DIR, "index.json"), encoding="utf-8"))
    except Exception as e:
        index = []
        err("index.json", f"invalid JSON: {e}")
    if not isinstance(index, list):
        err("index.json", "must be a list")
        index = []
    by_id = {t["id"]: t for t in templates}
    idx_ids = []
    for e in index:
        if not isinstance(e, dict) or set(e) != {"id", "title", "category", "tags", "summary"}:
            err("index.json", f"entries must be {{id, title, category, tags, summary}}: {e!r}"[:200])
            continue
        idx_ids.append(e["id"])
        t = by_id.get(e["id"])
        if not t:
            err("index.json", f"lists {e['id']!r} but there is no {e['id']}.json")
            continue
        for k in ("title", "category", "summary"):
            if e[k] != t[k]:
                err("index.json", f"{e['id']}: {k} does not match the template")
        if not isinstance(e["tags"], list) or not e["tags"] or not all(isinstance(x, str) and x for x in e["tags"]):
            err("index.json", f"{e['id']}: tags must be a non-empty list of strings")
    if sorted(idx_ids) != sorted(set(idx_ids)):
        err("index.json", "duplicate entries")
    missing = set(by_id) - set(idx_ids)
    if missing:
        err("index.json", f"templates missing from the catalog: {sorted(missing)}")

    readme = os.path.join(DIR, "README.md")
    if not os.path.isfile(readme) or "CC0" not in open(readme, encoding="utf-8").read():
        err("README.md", "missing, or does not state the CC0 dedication")

    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors:
            print("  -", e)
        return 1
    cats = {}
    for t in templates:
        cats[t["category"]] = cats.get(t["category"], 0) + 1
    print(f"PASS: {len(templates)} templates ({', '.join(f'{k} {v}' for k, v in sorted(cats.items()))}), "
          f"index.json {len(index)} entries, states.json {len(state_codes)} jurisdictions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
