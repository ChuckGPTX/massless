"""Write the contract library JSON into public/office/contracts/."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t_business, t_business2, t_everyday, t_realestate, t_realestate2, t_creative, t_music, states

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "office", "contracts")
os.makedirs(OUT, exist_ok=True)

templates = []
for m in (t_business, t_business2, t_everyday, t_realestate, t_realestate2, t_creative, t_music):
    templates += m.TEMPLATES

ids = [t["id"] for t in templates]
assert len(ids) == len(set(ids)), "duplicate ids"


catalog = []
for t in templates:
    tags = t.pop("_tags")
    with open(os.path.join(OUT, f"{t['id']}.json"), "w") as fh:
        json.dump(t, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    catalog.append(dict(id=t["id"], title=t["title"], category=t["category"], tags=tags, summary=t["summary"]))

order = ["everyday", "business", "real-estate", "creative-finance", "music", "joint-venture"]
catalog.sort(key=lambda c: (order.index(c["category"]), c["title"]))
with open(os.path.join(OUT, "index.json"), "w") as fh:
    json.dump(catalog, fh, indent=2, ensure_ascii=False)
    fh.write("\n")

with open(os.path.join(OUT, "states.json"), "w") as fh:
    json.dump(states.build(), fh, indent=2, ensure_ascii=False)
    fh.write("\n")

print(len(templates), "templates")
from collections import Counter
print(Counter(t["category"] for t in templates))
